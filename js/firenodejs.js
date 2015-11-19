//console.log("INFO\t: loading firenodejs");
var child_process = require('child_process');
var path = require("path");
var fs = require("fs");
var shared = require("../www/js/shared.js");

module.exports.firenodejs = (function() {
    ///////////////////////// private instance variables
    var started = new Date();

    ////////////////// constructor
    function firenodejs(images, firesight, measure, options) {
        var that = this;

        options = options || {};

        if ((that.images = images) == null) throw new Error("images is required");
        if ((that.measure = measure) == null) throw new Error("measure is required");
        if ((that.firesight = firesight) == null) throw new Error("firesight is required");
        if ((that.firestep = images.firestep) == null) throw new Error("firestep is required");
        if ((that.camera = images.camera) == null) throw new Error("camera is required");;
        that.modelPath = options.modelPath || '/var/firenodejs/firenodejs.json';
        that.model = options.model || {};
        that.models = {
            firestep: that.firestep.model,
            images: that.images.model,
            firesight: that.firesight.model,
            measure: that.measure.model,
            camera: that.camera.syncModel(),
            firenodejs: that.model,
        };
        that.services = {
            firestep: that.firestep,
            images: that.images,
            firesight: that.firesight,
            measure: that.measure,
            camera: that.camera,
            firenodejs: that,
        };
        try {
            console.log("INFO\t: loading existing firenodejs model");
            var models = JSON.parse(fs.readFileSync(that.modelPath));
            //shared.applyJson(that.models, models);
            var keys = Object.keys(models);
            for (var i=keys.length; i-- > 0; ) {
                var key = keys[i];
                if (that.services.hasOwnProperty(key)) {
                    var svc = that.services[key];
                    if (typeof svc.syncModel === "function") {
                        console.log("syncModel:"+ key, models[key]);
                        svc.syncModel(models[key]);
                    } else {
                        console.log("syncModel ignored:"+key, JSON.stringify(svc.model));
                    }
                }
            }
        } catch (e) {
            console.log("INFO\t: new firenodejs model created", e);
        }
        console.log("INFO\t: updating " + that.modelPath);
        that.syncModels({
            firenodejs: {
                version: {
                    major: 0,
                    minor: 4,
                    patch: 0
                },
                started: started.toString()
            }
        });

        return that;
    }

    firenodejs.prototype.syncModels = function(delta) {
        var that = this;
        if (delta) {
            shared.applyJson(that.models, delta);
            fs.writeFile(that.modelPath, JSON.stringify(that.models, null, '  '), function(err) {
                if (err instanceof Error) {
                    console.log("WARN\t: could not write " + that.modelPath, err);
                }
            });
        }
        var now = new Date();
        var msElapsed = now.getTime() - started.getTime();
        that.model.uptime = msElapsed / 1000;
        return that.models;
    }
    firenodejs.prototype.isAvailable = function() {
        var that = this;
        var result = false;
        result = result || that.camera.isAvailable();
        result = result || that.firestep.isAvailable();
        result = result || that.images.isAvailable();
        result = result || that.firesight.isAvailable();
        result = result || that.measure.isAvailable();
        return result;
    }

    return firenodejs;
})();