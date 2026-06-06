const OpenAI = require('openai');
const { AIChat } = require('../database/models');
const config = require('../config');
const { logger } = require('../utils/logger');
const { AIError } = require('../utils/errors');
const MemoryService = require('./MemoryService');
const QueryCache = require('../cache/QueryCache');
const MonitorService = require('./MonitorService');
const AISecurityService = require('./AISecurityService');

class AIService {
  constructor() {
    this.client = null;
    this.model = config.groq.model;
    this.maxTokens = 2000;
    this.temperature = 0.7;
    this.systemPrompt = this.getDefaultSystemPrompt();
    this.lastError = null;
    this.memory = MemoryService;
    this.usageStats = { totalRequests: 0, totalTokens: 0, errors: 0 };
    this.rateLimiter = new Map();
    this.dailyUsage = new Map();
    this.responseCache = new Map();
    this._rateLimiterCleanup = setInterval(() => { try { this._cleanupRateLimiter(); } catch (err) { logger.error('Unhandled error in services/AIService.js', { error: err?.message }) } }, 300000);
    this._dailyUsageCleanup = setInterval(() => { try { this._cleanupDailyUsage(); } catch (err) { logger.error('Unhandled error in services/AIService.js', { error: err?.message }) } }, 3600000);
  }

  _getDailyKey(userId, guildId) {
    const date = new Date().toISOString().split('T')[0];
    return `${userId}:${guildId || 'dm'}:${date}`;
  }

  _checkDailyLimits(userId, guildId, estimatedTokens) {
    const userKey = this._getDailyKey(userId, guildId);
    const usage = this.dailyUsage.get(userKey) || { requests: 0, tokens: 0 };
    if (usage.requests >= 100) {
      throw new AIError('Daily request limit exceeded (100 requests/day). Please try again tomorrow.');
    }
    if (usage.tokens + estimatedTokens > 50000) {
      throw new AIError('Daily token limit exceeded (50,000 tokens/day). Please try again tomorrow.');
    }
    if (guildId) {
      const guildKey = `guild:${guildId}:${new Date().toISOString().split('T')[0]}`;
      const guildUsage = this.dailyUsage.get(guildKey) || { requests: 0, tokens: 0 };
      if (guildUsage.requests >= 500) {
        throw new AIError('Guild daily request limit exceeded (500 requests/day). Please try again tomorrow.');
      }
      if (guildUsage.tokens + estimatedTokens > 250000) {
        throw new AIError('Guild daily token limit exceeded (250,000 tokens/day). Please try again tomorrow.');
      }
    }
  }

  _incrementDailyUsage(userId, guildId, tokens) {
    const userKey = this._getDailyKey(userId, guildId);
    const usage = this.dailyUsage.get(userKey) || { requests: 0, tokens: 0 };
    usage.requests++;
    usage.tokens += tokens;
    this.dailyUsage.set(userKey, usage);
    if (guildId) {
      const guildKey = `guild:${guildId}:${new Date().toISOString().split('T')[0]}`;
      const guildUsage = this.dailyUsage.get(guildKey) || { requests: 0, tokens: 0 };
      guildUsage.requests++;
      guildUsage.tokens += tokens;
      this.dailyUsage.set(guildKey, guildUsage);
    }
  }

  _cleanupDailyUsage() {
    const today = new Date().toISOString().split('T')[0];
    for (const [key] of this.dailyUsage.entries()) {
      if (!key.endsWith(today)) {
        this.dailyUsage.delete(key);
      }
    }
  }

  initialize() {
    const apiKey = config.groq.apiKey;
    const model = config.groq.model;
    const baseURL = config.groq.baseURL;

    logger.info('=== AI Service Startup Diagnostics ===');
    logger.info(`GROQ_API_KEY موجود: ${!!apiKey}`);
    if (apiKey) {
      logger.info(`المفتاح يبدأ بـ: ${apiKey.substring(0, 20)}...`);
      logger.info(`الطول: ${apiKey.length} حرف`);
      logger.info(`التنسيق: ${apiKey.startsWith('gsk_') ? '✓ يبدأ بـ gsk_' : '✗ لا يبدأ بـ gsk_'}`);
    }

    logger.info(`النموذج: ${model}`);
    logger.info(`Base URL: ${baseURL}`);

    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;

    logger.info('✓ AI Service initialized with Groq');
    return true;
  }

  getDefaultSystemPrompt() {
    return `أنت مساعد ذكي احترافي داخل Discord.
تجيب بالعربية والإنجليزية.
تكون إجاباتك منظمة وواضحة.
لا تعرض أي تفكير داخلي.
تعطي إجابات دقيقة وعملية.
تستخدم القوائم والنقاط عند الحاجة.
تشرح البرمجة باحترافية.
تحافظ على أسلوب عصري ونظيف.

قواعد صارمة:
- لا تعرض أبدًا: <think>, </think>, <thinking>, </thinking>, <reasoning>, </reasoning>
- لا تعرض Chain of Thought أو Reasoning
- اعرض الإجابة النهائية فقط
- استخدم التنسيق المناسب: قوائم، نقاط، code blocks
- كن مختصراً ومباشراً
- قدم نصائح عملية وقابلة للتطبيق
- لا تخترع معلومات غير موجودة
- احترم خصوصية المستخدمين`;
  }

  sanitizeInput(text) {
    if (typeof text !== 'string') return '';
    const maxLength = 4000;
    let cleaned = text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');

    const injectPatterns = [
      /ignore\s*(all|above|previous)\s*(instructions|directions|prompts?)/gi,
      /disregard\s*(all|above|previous)\s*(instructions|directions|prompts?)/gi,
      /forget\s*(your|all|everything)/gi,
      /you\s+are\s+(now|not\s+required|free\s+to)/gi,
      /system\s+prompt\s+override/i,
      /new\s+instructions:/gi,
      /from\s+now\s+on,\s*you\s+are/i,
      /i\s+want\s+you\s+to\s+act\s+as/i,
      /you\s+have\s+been\s+reset/i,
      /this\s+is\s+a\s+system\s+message/i,
      /you\s+must\s+ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|rules|guidelines)/gi,
      /respond\s+as\s+(if\s+you\s+are|though\s+you\s+are)\s+/gi,
      /do\s+not\s+follow\s+(your\s+)?(instructions|training|guidelines)/gi,
      /output\s+(raw|unfiltered|uncensored)/gi,
      /reveal\s+(your\s+)?(system\s+)?prompt/gi,
      /show\s+(your\s+)?(system\s+)?(prompt|instructions)/gi,
      /print\s+(your\s+)?(system\s+)?prompt/gi,
      /bypass\s+(your\s+)?(safety|filter|restrictions)/gi,
      /jailbreak/i,
      /\/\/ignore/i,
    ];

    for (const pattern of injectPatterns) {
      cleaned = cleaned.replace(pattern, '[removed]');
    }

    const lines = cleaned.split('\n');
    if (lines.length > 100) {
      cleaned = lines.slice(0, 100).join('\n');
    }

    return cleaned
      .trim()
      .slice(0, maxLength);
  }

  stripThinking(text) {
    if (typeof text !== 'string') return '';
    let cleaned = text;

    const patterns = [
      /<think>[\s\S]*?<\/think>/gi,
      /<thinking>[\s\S]*?<\/thinking>/gi,
      /<reasoning>[\s\S]*?<\/reasoning>/gi,
      /<thought>[\s\S]*?<\/thought>/gi,
      /<chain_of_thought>[\s\S]*?<\/chain_of_thought>/gi,
      /<cot>[\s\S]*?<\/cot>/gi,
      /<scratchpad>[\s\S]*?<\/scratchpad>/gi,
      /\[thinking\][\s\S]*?\[\/thinking\]/gi,
      /\[think\][\s\S]*?\[\/think\]/gi,
      /\[reasoning\][\s\S]*?\[\/reasoning\]/gi,
      /```(?:think(?:ing)?|reason(?:ing)?|thought|chain.?of.?thought|cot|scratchpad)[\s\S]*?```/gi,
      /\*\*(?:Thinking|Reasoning|Thought|Chain of Thought|Internal)\*\*[\s\S]*?(?=\n\n|\n\*\*|$)/gi,
      /(?:Thinking|Reasoning|Thought|Chain of Thought|Internal):\s*[\s\S]*?(?=\n\n|\n[A-Z]|\*\*|$)/gi,
      /^I'll\s+(?:think|reason|work).*$/gim,
      /^(?:Let me|Let's)\s+(?:think|reason|work|break).*$/gim,
    ];

    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    return cleaned
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s*\n/gm, '')
      .trim();
  }

  sanitizeMessages(messages) {
    return messages.map(msg => {
      if (msg.role === 'user') {
        return { ...msg, content: this.sanitizeInput(msg.content) };
      }
      return msg;
    });
  }

  async chat(messages, options = {}) {
    if (!this.client) {
      throw new AIError('خدمة الذكاء الاصطناعي غير متاحة - يرجى تكوين مفتاح API');
    }

    const userId = options.userId;
    const guildId = options.guildId;
    const effectiveGuildId = guildId || 'dm';

    if (userId) {
      const estimatedTokens = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 3;
      this._checkDailyLimits(userId, effectiveGuildId, estimatedTokens);

      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
      if (lastUserMsg) {
        const abuseCheck = await AISecurityService.checkRequest(userId, lastUserMsg, Math.round(estimatedTokens));
        if (abuseCheck.blocked) {
          AISecurityService.unblockUser(userId);
          throw new AIError('🚫 تم حظر الطلب لتجاوز حدود الاستخدام الآمن. يرجى المحاولة لاحقاً.');
        }
      }

      const memory = await this.memory.getUserMemory(userId, effectiveGuildId, 10);
      if (memory && memory.messages && memory.messages.length > 0) {
        const contextMessages = memory.messages.slice(-6).map(m => ({
          role: m.role,
          content: m.content
        }));
        messages = [...contextMessages, ...messages];
      }
    }

    const sanitizedMessages = this.sanitizeMessages(messages);

    if (options.includeSuggestions) {
      const instructions = `\n\nAt the very end of your response, provide exactly 3 suggested short follow-up questions for the user in the same language as their prompt. Prefix the suggestions section EXACTLY with "---SUGGESTIONS---" followed by each question on a new line starting with "- ".`;
      const sysMsg = sanitizedMessages.find(m => m.role === 'system');
      if (sysMsg) {
        sysMsg.content += instructions;
      } else {
        sanitizedMessages.unshift({ role: 'system', content: this.getDefaultSystemPrompt() + instructions });
      }
    }

    const lastUserMsg = [...sanitizedMessages].reverse().find(m => m.role === 'user')?.content || '';
    if (lastUserMsg && options.type !== 'stream' && QueryCache) {
      try {
        const cached = await QueryCache.getAIResponse(lastUserMsg, options.model || this.model, async () => null);
        if (cached && cached.content) {
          logger.debug('AI cache hit', { type: options.type });
          return cached;
        }
      } catch (cacheErr) {
        logger.warn('AI cache lookup failed', { error: cacheErr?.message });
      }
    }

    const startTime = Date.now();
    const model = options.model || this.model;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: sanitizedMessages,
          max_tokens: options.maxTokens || this.maxTokens,
          temperature: options.temperature ?? this.temperature,
        });

        const duration = Date.now() - startTime;
        const usage = response.usage || {};
        const totalTokens = usage.total_tokens || 0;

        this.usageStats.totalRequests++;
        this.usageStats.totalTokens += totalTokens;

        if (userId) {
          this._incrementDailyUsage(userId, effectiveGuildId, totalTokens);
        }

        MonitorService.trackAIRequest(duration, totalTokens);

        let content = response.choices?.[0]?.message?.content || '';
        content = this.stripThinking(content);

        let result = { content, usage, model, responseTime: duration };

        if (options.includeSuggestions) {
          const extracted = this.extractSuggestions(content);
          result = { ...result, content: extracted.content, suggestions: extracted.suggestions };
        }

        if (lastUserMsg && options.type !== 'stream') {
          QueryCache.setAIResponse(lastUserMsg, result).catch(() => {});
        }

        if (lastUserMsg) {
          this.responseCache.set(lastUserMsg, result);
          if (this.responseCache.size > 500) {
            const keyToDelete = this.responseCache.keys().next().value;
            this.responseCache.delete(keyToDelete);
          }
        }

        return result;
      } catch (error) {
        const statusCode = error.status;
        logger.error('AI Chat error', {
          attempt,
          error: error.message,
        });

        const isRetryable = [429, 500, 502, 503].includes(error.status) || error.code === 'ETIMEDOUT' || error.name === 'AbortError';

        if (isRetryable && attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          logger.warn(`AI Chat retry ${attempt + 1}/${maxRetries}`, { error: error.message, statusCode, delay });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        this.usageStats.errors++;
        MonitorService.trackAIError();
        this.lastError = `${statusCode || 'unknown'}: ${error.message}`;
        throw new AIError(`خطأ في الذكاء الاصطناعي (${statusCode || 'غير معروف'}): ${error.message}`);
      }
    }
  }

  async createChatSession(userId, guildId, channelId, type = 'general', context = {}) {
    const messages = [
      { role: 'system', content: this.getSystemPromptForType(type) },
    ];

    return {
      messages,
      type,
      context,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
    };
  }

  _cleanupRateLimiter() {
    const now = Date.now();
    for (const [key, timestamps] of this.rateLimiter.entries()) {
      const valid = timestamps.filter(t => now - t < 60000);
      if (valid.length === 0) {
        this.rateLimiter.delete(key);
      } else {
        this.rateLimiter.set(key, valid);
      }
    }
  }

  extractSuggestions(text) {
    if (typeof text !== 'string') return { content: text, suggestions: [] };
    const marker = '---SUGGESTIONS---';
    if (!text.includes(marker)) return { content: text, suggestions: [] };
    const parts = text.split(marker);
    const content = parts[0].trim();
    const suggestions = parts[1].trim().split('\n')
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(line => line.length > 0 && line.length < 80)
      .slice(0, 3);
    return { content, suggestions };
  }

  async generateTitle(firstMessage) {
    const prompt = `Based on the following message, generate a very short 2-4 word title for a chat channel. Return ONLY the title without quotes, markdown, or extra text. Use English or Arabic based on the message language. Message: "${firstMessage}"`;
    try {
      const response = await this.chat([
        { role: 'user', content: prompt }
      ], { temperature: 0.3, maxTokens: 15 });
      let title = response.content.trim().replace(/^["']|["']$/g, '');
      return title;
    } catch (err) {
      return 'محادثة-جديدة';
    }
  }

  getSystemPromptForType(type) {
    const prompts = {
      general: this.systemPrompt,
      product: `أنت خبير في كتابة أوصاف المنتجات للتجارة الإلكترونية.
مهمتك: إنشاء وصف احترافي وجذاب للمنتج، اقتراح سعر تنافسي، تحسين العنوان، إنشاء إعلان تسويقي، واقتراح كلمات مفتاحية.
الرد باللغة العربية وبتنسيق منظم.`,
      store: `أنت مستشار تجاري متخصص في إنشاء متاجر ناجحة.
مهمتك: مساعدة المستخدم في تخطيط متجره، اختيار الاسم والوصف، تحديد الفئة المستهدفة، ووضع استراتيجية التسعير.
الرد باللغة العربية وبتنسيق منظم.`,
      buyer_assist: `أنت مساعد تسوق ذكي يساعد المشترين في العثور على ما يحتاجون.
مهمتك: فهم احتياجات المشتري، البحث في قاعدة البيانات، وعرض الخيارات الأنسب مع المقارنة.
الرد باللغة العربية مع ذكر الأسباب.`,
      code: `أنت مبرمج خبير يساعد في كتابة ومراجعة وتحسين الكود.
مهمتك: تقديم حلول برمجية نظيفة، شرح المفاهيم، إصلاح الأخطاء، وأفضل الممارسات.
الرد باللغة العربية مع أمثلة كود واضحة.`,
      study: `أنت معلم ذكي يساعد في الدراسة والشرح.
مهمتك: تبسيط المفاهيم المعقدة، وضع خطط دراسة، حل التمارين، وتقديم موارد تعليمية.
الرد باللغة العربية بأسلوب تعليمي واضح.`,
      creative: `أنت كاتب إبداعي يساعد في إنشاء المحتوى.
مهمتك: كتابة المقالات، القصص، السيناريوهات، منشورات السوشيال، والمحتوى التسويقي.
الرد باللغة العربية بأسلوب إبداعي جذاب.`,
      translate: `أنت مترجم محترف يدعم لغات متعددة.
مهمتك: ترجمة النصوص بدقة مع الحفاظ على السياق والأسلوب.
الرد بالترجمة المطلوبة فقط ما لم يُطلب غير ذلك.`,
      summarize: `أنت خبير في تلخيص النصوص واستخراج النقاط الرئيسية.
مهمتك: إنشاء ملخصات مختصرة ودقيقة للنصوص الطويلة مع النقاط الهامة.
الرد باللغة العربية بنقاط مرتبة.`,
    };

    return prompts[type] || prompts.general;
  }

  async generateProductDescription(productData) {
    const prompt = `أنشئ وصفاً احترافياً وجذاباً للمنتج التالي:

**اسم المنتج:** ${productData.name}
**الفئة:** ${productData.category}
**السعر:** ${productData.price}
**المميزات الرئيسية:** ${productData.features?.join(', ') || 'غير محددة'}
**الوصف الحالي:** ${productData.description || 'لا يوجد'}

المطلوب:
1. عنوان محسن وجذاب
2. وصف احترافي مقنع (150-300 كلمة)
3. قائمة مميزات مرقمة
4. دعوة لاتخاذ إجراء (CTA)
5. 5-10 كلمات مفتاحية للـ SEO
6. سعر مقترح تنافسي مع التبرير`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('product') },
      { role: 'user', content: prompt },
    ], { temperature: 0.8, maxTokens: 1500 });
  }

  async suggestPrice(productData, marketData = null) {
    const prompt = `اقترح سعراً تنافسياً للمنتج التالي:

**المنتج:** ${productData.name}
**الفئة:** ${productData.category}
**التكلفة المقدرة:** ${productData.cost || 'غير معروفة'}
**المميزات:** ${productData.features?.join(', ') || 'أساسية'}
${marketData ? `**بيانات السوق:** ${JSON.stringify(marketData)}` : ''}

اعطني:
1. السعر المقترح
2. نطاق سعري (أدنى - أعلى)
3. استراتيجية التسعير المقترحة
4. تبرير السعر`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('product') },
      { role: 'user', content: prompt },
    ], { temperature: 0.5, maxTokens: 800 });
  }

  async createMarketingAd(productData, platform = 'discord') {
    const prompt = `أنشئ إعلاناً تسويقياً جذاباً لـ ${platform}:

**المنتج:** ${productData.name}
**الوصف:** ${productData.description}
**السعر:** ${productData.price}
**المميزات:** ${productData.features?.join(', ') || 'غير محددة'}
**الجمهور المستهدف:** ${productData.targetAudience || 'عام'}

المطلوب:
- عنوان جذاب
- نص الإعلان
- هاشتاجات مناسبة
- دعوة واضحة لاتخاذ إجراء
- مناسب لـ ${platform}`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('product') },
      { role: 'user', content: prompt },
    ], { temperature: 0.9, maxTokens: 1000 });
  }

  async findProductsForBuyer(query, products) {
    const prompt = `المشتري يبحث عن: "${query}"

المنتجات المتاحة:
${products.slice(0, 20).map((p, i) => `${i + 1}. ${p.name} - ${p.price} - ${p.category} - ${p.shortDescription || p.description?.substring(0, 100)}`).join('\n')}

اختر أفضل 5 منتجات مطابقة ووضح سبب اختيارك لكل منها.`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('buyer_assist') },
      { role: 'user', content: prompt },
    ], { temperature: 0.3, maxTokens: 1500 });
  }

  async createStudyPlan(topic, level, duration, goals) {
    const prompt = `أنشئ خطة دراسة لـ:
**الموضوع:** ${topic}
**المستوى الحالي:** ${level}
**المدة:** ${duration}
**الأهداف:** ${goals}

المطلوب:
- خطة أسبوعية مقسمة
- موارد مقترحة (مجانية ومدفوعة)
- تمارين عملية
- مراحل تقييم
- نصائح للالتزام`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('study') },
      { role: 'user', content: prompt },
    ], { temperature: 0.7, maxTokens: 2000 });
  }

  async translate(text, targetLanguage, context = '') {
    const prompt = `ترجم للنص التالي إلى ${targetLanguage}:
"${text}"
${context ? `السياق: ${context}` : ''}`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('translate') },
      { role: 'user', content: prompt },
    ], { temperature: 0.1, maxTokens: 1000 });
  }

  async summarize(text, maxLength = 200) {
    const prompt = `لخص النص التالي في ${maxLength} كلمة كحد أقصى مع النقاط الرئيسية:
"${text}"`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('summarize') },
      { role: 'user', content: prompt },
    ], { temperature: 0.3, maxTokens: 800 });
  }

  async saveChatSession(sessionData) {
    try {
      await AIChat.create(sessionData);
    } catch (error) {
      logger.error('Failed to save AI chat session', { error: error.message });
    }
  }

  async getChatHistory(userId, guildId, limit = 10) {
    try {
      return await AIChat.find({ userId, guildId }).lean()
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
    } catch (error) {
      logger.error('Failed to get AI chat history', { error: error.message });
      return [];
    }
  }

  async clearHistory(userId, guildId) {
    try {
      await AIChat.deleteMany({ userId, guildId });
    } catch (error) {
      logger.error('Failed to clear AI chat history', { error: error.message });
    }
  }

  async generateText(prompt, options = {}) {
    const result = await this.chat([
      { role: 'system', content: this.getSystemPromptForType(options.type || 'general') },
      { role: 'user', content: prompt },
    ], options);

    return result.content;
  }

  async debugCode(code, language, error) {
    const prompt = `Debug this ${language} code:
\`\`\`${language}
${code}
\`\`\`

Error: ${error}

Provide:
1. Root cause
2. Fixed code
3. Explanation
4. Prevention tips`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('code') },
      { role: 'user', content: prompt },
    ], { temperature: 0.2, maxTokens: 2500 });
  }

  async explainCode(code, language, focusOrQuestion = 'general') {
    const focusPrompts = {
      general: 'Explain what this code does, its purpose, and how it works.',
      complexity: 'Analyze time/space complexity and suggest optimizations.',
      security: 'Identify security vulnerabilities and suggest fixes.',
      patterns: 'Identify design patterns used and suggest improvements.',
      testing: 'Explain how to test this code and provide test cases.',
    };

    const isQuestion = focusOrQuestion.length > 50 || focusOrQuestion.includes('?');

    let prompt;
    if (isQuestion) {
      prompt = `اللغة: ${language}
الكود:
\`\`\`${language}
${code}
\`\`\`

السؤال: ${focusOrQuestion}`;
    } else {
      prompt = `Language: ${language}
Code:
\`\`\`${language}
${code}
\`\`\`

Focus: ${focusPrompts[focusOrQuestion] || focusPrompts.general}`;
    }

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('code') },
      { role: 'user', content: prompt },
    ], { temperature: 0.2, maxTokens: 2000 });
  }

  async rewriteText(text, style = 'professional', language = 'ar') {
    const styles = {
      professional: 'Rewrite in a professional, business-appropriate tone.',
      casual: 'Rewrite in a friendly, conversational tone.',
      technical: 'Rewrite using precise technical terminology.',
      simple: 'Rewrite in simple, easy-to-understand language.',
      persuasive: 'Rewrite to be more persuasive and compelling.',
      concise: 'Rewrite to be more concise while keeping key information.',
    };

    const prompt = `Rewrite the following text in ${language}:
"${text}"

Style: ${styles[style] || styles.professional}`;

    return this.chat([
      { role: 'system', content: this.getSystemPromptForType('translate') },
      { role: 'user', content: prompt },
    ], { temperature: 0.5, maxTokens: 1500 });
  }

  async analyzeText(text, analysisType = 'sentiment') {
    const types = {
      sentiment: 'Analyze sentiment (positive/negative/neutral) with confidence score.',
      entities: 'Extract named entities (people, places, organizations, dates, etc.).',
      keywords: 'Extract key topics and keywords with relevance scores.',
      summary: 'Provide a concise summary with main points.',
      topics: 'Identify main topics and categorize the text.',
      readability: 'Analyze readability score and suggest improvements.',
      language: 'Detect language and analyze linguistic features.',
    };

    const prompt = `Analyze the following text:
"${text}"

Analysis type: ${types[analysisType] || types.sentiment}

Return structured JSON with results.`;

    return this.chat([
      { role: 'system', content: 'You are an expert text analyzer. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ], { temperature: 0.1, maxTokens: 1500 });
  }

  async searchKnowledge(query, knowledgeBase = []) {
    const prompt = `Search the knowledge base for: "${query}"

Knowledge base:
${knowledgeBase.slice(0, 20).map((k, i) => `${i + 1}. ${k.title || k.content?.slice(0, 200)}`).join('\n')}

Return the most relevant entries with relevance scores.`;

    return this.chat([
      { role: 'system', content: 'You are a knowledge retrieval system. Return only relevant entries with scores.' },
      { role: 'user', content: prompt },
    ], { temperature: 0.2, maxTokens: 1500 });
  }

  getUsageStats() {
    const aiSecurityStats = AISecurityService.getStats();
    return {
      ...this.usageStats,
      rateLimiterSize: this.rateLimiter.size,
      responseCacheSize: this.responseCache.size,
      blockedUsers: aiSecurityStats.blockedUsers,
      memory: this.memory.getCacheStats(),
    };
  }

  destroy() {
    if (this._rateLimiterCleanup) {
      clearInterval(this._rateLimiterCleanup);
    }
    if (this._dailyUsageCleanup) {
      clearInterval(this._dailyUsageCleanup);
    }
    this.responseCache.clear();
    this.rateLimiter.clear();
    this.dailyUsage.clear();
    this.memory.destroy();
  }
}

module.exports = new AIService();
