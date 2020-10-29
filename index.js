const mongoose = require('mongoose');

const { Schema, Model } = mongoose;

/**
 * This code is taken from official mongoose repository
 * https://github.com/Automattic/mongoose/blob/master/lib/query.js#L3847-L3873
 */
const parseUpdateArguments = (conditions, doc, options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  } else if (typeof doc === 'function') {
    callback = doc;
    doc = conditions;
    conditions = {};
    options = null;
  } else if (typeof conditions === 'function') {
    callback = conditions;
    conditions = null;
    doc = null;
    options = null;
  } else if (typeof conditions === 'object' && !doc && !options && !callback) {
    doc = conditions;
    conditions = null;
    options = null;
    callback = null;
  }

  const args = [];

  if (conditions) args.push(conditions);
  if (doc) args.push(doc);
  if (options) args.push(options);
  if (callback) args.push(callback);

  return args;
};

const parseIndexFields = (options) => {
  const indexFields = {
    deleted: false,
    deleted_at: false,
  };

  if (!options.indexFields) {
    return indexFields;
  }

  if ((typeof options.indexFields === 'string' || options.indexFields instanceof String) && options.indexFields === 'all') {
    indexFields.deleted = true;
    indexFields.deleted_at = true;
  }

  if (typeof (options.indexFields) === 'boolean' && options.indexFields === true) {
    indexFields.deleted = true;
    indexFields.deleted_at = true;
  }

  if (Array.isArray(options.indexFields)) {
    indexFields.deleted = options.indexFields.indexOf('deleted') > -1;
    indexFields.deleted_at = options.indexFields.indexOf('deleted_at') > -1;
  }

  return indexFields;
};

const createSchemaObject = (typeKey, typeValue, options) => {
  options[typeKey] = typeValue;
  return options;
};

module.exports = (schema, options) => {
  options = options || {};
  const indexFields = parseIndexFields(options);

  const { typeKey } = schema.options;
  const mongooseMajorVersion = +mongoose.version[0];
  const mainUpdateMethod = 'updateMany';
  schema.add({ deleted: createSchemaObject(typeKey, Schema.Types.ObjectId, { default: null, index: indexFields.deleted }) });
  schema.add({ deleted_at: createSchemaObject(typeKey, Date, { default: null, index: indexFields.deleted_at }) });

  let use$neOperator = true;
  if (options.use$neOperator !== undefined && typeof options.use$neOperator === 'boolean') {
    use$neOperator = options.use$neOperator;
  }

  schema.pre('save', (next) => {
    if (!this.deleted) {
      this.deleted = false;
    }
    next();
  });

  if (options.overrideMethods) {
    const overrideItems = options.overrideMethods;
    const overridableMethods = ['count', 'countDocuments', 'find', 'findOne', 'findOneAndUpdate', 'update', 'updateMany', 'aggregate'];
    let finalList = [];

    if ((typeof overrideItems === 'string' || overrideItems instanceof String) && overrideItems === 'all') {
      finalList = overridableMethods;
    }

    if (typeof (overrideItems) === 'boolean' && overrideItems === true) {
      finalList = overridableMethods;
    }

    if (Array.isArray(overrideItems)) {
      overrideItems.forEach((method) => {
        if (overridableMethods.indexOf(method) > -1) {
          finalList.push(method);
        }
      });
    }

    schema.pre('aggregate', function () {
      const firsMatchStr = JSON.stringify(this.pipeline()[0]);

      if (firsMatchStr !== '{"$match":{"deleted_at":{"$ne":false}}}') {
        if (firsMatchStr === '{"$match":{"showAllDocuments":"true"}}') {
          this.pipeline().shift();
        } else {
          this.pipeline().unshift({ $match: { deleted_at: { $eq: null } } });
        }
      }
    });

    finalList.forEach(function (method) {
      if (['count', 'countDocuments', 'find', 'findOne'].indexOf(method) > -1) {
        let modelMethodName = method;

        /* istanbul ignore next */
        if (mongooseMajorVersion < 5 && method === 'countDocuments' && typeof Model.countDocuments !== 'function') {
          modelMethodName = 'count';
        }

        schema.statics[method] = function () {
          if (use$neOperator) {
            return Model[modelMethodName].apply(this, arguments).where('deleted_at').eq(null);
          }

          return Model[modelMethodName].apply(this, arguments).where({ deleted_at: null });
        };
        schema.statics[`${method}Deleted`] = function () {
          if (use$neOperator) {
            return Model[modelMethodName].apply(this, arguments).where('deleted_at').eq(null);
          }
          return Model[modelMethodName].apply(this, arguments).where({ deleted_at: null });
        };

        schema.statics[`${method}WithDeleted`] = function () {
          return Model[modelMethodName].apply(this, arguments);
        };
      } else if (method === 'aggregate') {
        schema.statics[`${method}Deleted`] = function () {
          const args = [];
          Array.prototype.push.apply(args, arguments);

          const match = {
            $match: {
              deleted_at: {
                $eq: null,
              },
            },
          };

          if (arguments.length) {
            args[0].unshift(match);
          } else {
            args.push([match]);
          }

          return Model[method].apply(this, args);
        };

        schema.statics[`${method}WithDeleted`] = function () {
          const args = [];
          Array.prototype.push.apply(args, arguments);
          const match = {
            $match: {
              showAllDocuments: 'true',
            },
          };

          if (arguments.length) {
            args[0].unshift(match);
          } else {
            args.push([match]);
          }

          return Model[method].apply(this, args);
        };
      } else {
        schema.statics[method] = function () {
          const args = parseUpdateArguments(...arguments);
          args[0].deleted_at = { $eq: null };
          return Model[method].apply(this, args);
        };

        schema.statics[`${method}Deleted`] = function () {
          const args = parseUpdateArguments(...arguments);

          args[0].deleted_at = { $eq: null };

          return Model[method].apply(this, args);
        };

        schema.statics[`${method}WithDeleted`] = function () {
          return Model[method].apply(this, arguments);
        };
      }
    });
  }

  schema.methods.delete = function (cb) {
    this.deleted = this._id;

    if (schema.path('deleted_at')) {
      this.deleted_at = new Date();
    }

    if (options.validateBeforeDelete === false) {
      return this.save({ validateBeforeSave: false }, cb);
    }

    return this.save(cb);
  };

  schema.statics.delete = function (conditions, callback) {
    const doc = {
      deleted: conditions._id,
    };

    if (schema.path('deleted_at')) {
      doc.deleted_at = new Date();
    }

    if (this.updateWithDeleted) {
      return this.updateWithDeleted(conditions, doc, { multi: true }, callback);
    }

    return this[mainUpdateMethod](conditions, doc, { multi: true }, callback);
  };

  schema.statics.deleteById = function (id, deletedBy, callback) {
    if (arguments.length === 0 || typeof id === 'function') {
      const msg = 'First argument is mandatory and must not be a function.';
      throw new TypeError(msg);
    }

    const conditions = {
      _id: id,
    };

    return this.delete(conditions, deletedBy, callback);
  };
};
