'use strict';

var services = angular.module('firenodejs.services');
var JsonUtil = require("./shared/JsonUtil");
var Synchronizer = require("./shared/Synchronizer");

services.factory('firenodejs-service', [
    '$http',
    'AlertService',
    'firestep-service',
    'camera-service',
    'firesight-service',
    'images-service',
    'measure-service',
    'mesh-service',
    'firekue-service',
    'UpdateService',
    function($http, alerts, firestep, camera, firesight, images, measure, mesh, firekue, updateService) {
        function availableIcon(test) {
            if (test === true) {
                return "glyphicon glyphicon-ok fr-test-pass";
            } else if (test === null) {
                return "glyphicon glyphicon-transfer fr-test-tbd";
            } else {
                return "glyphicon glyphicon-remove fr-test-fail";
            }
        }

        var syncUrl = "/firenodejs/models";
        var lastActive = new Date();
        var model = {};
        var clients = {
            camera: camera,
            firestep: firestep,
            firesight: firesight,
            measure: measure,
            images: images,
            mesh: mesh,
            firekue: firekue,
        };
        var models = {
            age: 0,
            firestep: firestep.model,
            images: images.model,
            firesight: firesight.model,
            measure: measure.model,
            mesh: mesh.model,
            camera: camera.model,
            firekue: firekue.model,
            firenodejs: model,
        };
        var service = {
            syncNew: true,
            clients: clients,
            alert: {},
            model: model,
            models: models,
            idleUpdate: function() {
                if (service.alert.sync && service.isIdle()) {
                    alerts.close(service.alert.sync);
                    delete service.alert.sync;
                    var ready = alerts.success("Connected to firenodejs");
                    setTimeout(function() {
                        alerts.close(ready);
                    }, 5000);
                }
            },
            halt: function() {
                var postData = {
                    "exec": "halt",
                };
                var fyi = alerts.danger("System shutdown in progress...");
                updateService.setPollBase(true);
                alerts.taskBegin();
                $http.post("/firenodejs/shell", postData).success(function(syncMsgIn, status, headers, config) {
                    setTimeout(function() {
                        alerts.close(fyi);
                        updateService.setPollBase(true);
                    }, 5000);
                    service.shutdown = true;
                    alerts.taskEnd();
                }).error(function(err, status, headers, config) {
                    alerts.close(fyi);
                    alerts.danger("HTTP" + status + ":" + JSON.stringify(err));
                    alerts.taskEnd();
                });
            },
            isIdle: function() {
                return service.synchronizer.idle && !alerts.isBusy();
            },
            synchronizer: new Synchronizer(models, {
                beforeUpdate: function(diff) {
                    updateService.notifyBefore(diff);
                },
                afterUpdate: function(diff) {
                    updateService.notifyAfter(diff);
                },
            }),
            requestSync: function() {
                updateService.setPollBase(true);
                var info = alerts.info("Checking server for updates...");
                service.syncServer();
                setTimeout(function() {
                    alerts.close(info);
                }, 3000);
            },
            syncServer: function() {
                var pollBase = updateService.isPollBase();
                if (pollBase) {
                    pollBase = !alerts.isBusy() && pollBase;
                    pollBase && updateService.setPollBase(false);
                }
                var postData = service.synchronizer.createSyncRequest({
                    pollBase: pollBase,
                });
                pollBase && console.log("postData:", postData);
                if (postData) {
                    alerts.taskBegin();
                    $http.post("/firenodejs/sync", postData).success(function(syncMsgIn, status, headers, config) {
                        var syncMsgOut = service.synchronizer.sync(syncMsgIn);
                        Logger.start("SYNC=>", syncMsgOut);
                        model.available = true;
                        alerts.taskEnd();
                    }).error(function(err, status, headers, config) {
                        console.warn("firenodejs.sync(", syncMsgIn, ") failed HTTP" + status);
                        model.available = false;
                        alerts.taskEnd();
                    });
                }
                return postData;
            },
            onMousedown: function(evt) {
                lastActive = new Date();
            },
            onKeypress: function(evt) {
                lastActive = new Date();
            },
            imageVersion: function(img) {
                var mpo = firestep.model.mpo;
                var locationHash = firestep.isAvailable() && mpo ?
                    (mpo["1"] + "_" + mpo["2"] + "_" + mpo["3"]) : 0;
                //(firestep.model.mpo.x ^ firestep.model.mpo.y ^ firestep.model.mpo.z) : 0;
                if (img == null) {
                    return locationHash;
                }
                var tokens = img.split("/");
                if (tokens[1] === "images") {
                    return locationHash + "S" + images.saveCount;
                } else if (tokens[1] === "firesight") {
                    return locationHash + "P" + firesight.processCount;
                }
                return locationHash + "C" + camera.changeCount;
            },
            isAvailable: function() {
                return model.available;
            },
            bind: function(scope) {
                service.scope = scope;
                scope.firenodejs = service;
                scope.camera = camera;
                scope.firestep = firestep;
                scope.firesight = firesight;
                scope.images = images;
                scope.measure = measure;
                scope.mesh = mesh;
                scope.firekue = firekue;
                scope.availableIcon = availableIcon;
            }
        };

        var initializationRetries = 3;

        function backgroundThread() {
            var msIdle = new Date() - lastActive;
            // TODO: update multiple browsers
            var pollServer = msIdle > 2000 || !service.model.available;
            var postData = pollServer && service.syncServer();
            if (!postData && !alerts.isBusy()) {
                updateService.notifyIdle(msIdle);
            }
        }
        var background = setInterval(backgroundThread, 1000);

        service.alert.sync = alerts.info("Connecting to firenodejs...");
        updateService.onIdleUpdate(service.idleUpdate);
        Logger.start("firenodejs service initalized");

        return service;
    }
]);

function firenodejs_noimage() {
    var src = "data:image/png;base64,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";
    return src;
}

services.directive('noImage', function() {
    var setDefaultImage = function(el) {
        el.attr('src', firenodejs_noimage());
    };

    return {
        restrict: 'A',
        link: function(scope, el, attr) {
            scope.$watch(function() {
                return attr.ngSrc;
            }, function() {
                var src = attr.ngSrc;

                if (!src) {
                    setDefaultImage(el);
                }
            });

            el.bind('error', function() {
                setDefaultImage(el);
            });
        }
    };
});
