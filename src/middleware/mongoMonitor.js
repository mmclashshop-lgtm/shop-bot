const MonitorService = require('../services/MonitorService');

function setupMongoMonitoring(mongoose) {
  mongoose.connection.on('connected', () => {
    MonitorService.trackMongoOp();
  });

  mongoose.connection.on('error', (err) => {
    MonitorService.trackMongoError(err);
  });

  const originalFind = mongoose.Model.find;
  mongoose.Model.find = function (...args) {
    MonitorService.trackMongoOp();
    return originalFind.apply(this, args);
  };

  const originalFindOne = mongoose.Model.findOne;
  mongoose.Model.findOne = function (...args) {
    MonitorService.trackMongoOp();
    return originalFindOne.apply(this, args);
  };

  const originalFindOneAndUpdate = mongoose.Model.findOneAndUpdate;
  mongoose.Model.findOneAndUpdate = function (...args) {
    MonitorService.trackMongoOp();
    return originalFindOneAndUpdate.apply(this, args);
  };

  const originalUpdateOne = mongoose.Model.updateOne;
  mongoose.Model.updateOne = function (...args) {
    MonitorService.trackMongoOp();
    return originalUpdateOne.apply(this, args);
  };

  const originalInsertOne = mongoose.Model.create;
  mongoose.Model.create = function (...args) {
    MonitorService.trackMongoOp();
    return originalInsertOne.apply(this, args);
  };
}

module.exports = { setupMongoMonitoring };
