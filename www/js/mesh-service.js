'use strict';

var services = angular.module('firenodejs.services');
var should = require("./should");
var DeltaMesh = require("./shared/DeltaMesh");

services.factory('mesh-service', ['$http', 'AlertService', 'firestep-service', 'camera-service','$document',
    function($http, alerts, firestep, camera, $document) {
        var propInfo = {
            gcw: {
                name: "GridCellW",
                title: "Horizontal pixel separation of vertical grid lines"
            },
            gch: {
                name: "GridCellH",
                title: "Vertical pixel separation of horizontal grid lines"
            },
            ga: {
                name: "GridAngle",
                title: "Counter-clockwise angle in degrees between image x-axis and grid horizontal axis"
            },
            gox: {
                name: "GridOriginX",
                title: "x-position of grid intersection closest to image center"
            },
            goy: {
                name: "GridOriginY",
                title: "y-position of grid intersection closest to image center"
            },
        };
        var clientDefault = {
            roi: {
                type: "rect",
                cx: 0,
                cy: 0,
                width: 150,
                height: 150,
            },
            props: {
                gcw: true,
                gch: true,
                ga: true,
                gox: false,
                goy: false,
            },
        };
        var client;
        var model = {
            name: "mesh-service",
            client: client,
        };
        var service = {
            isAvailable: function() {
                return service.model.rest && firestep.isAvailable();
            },
            color: {
                vertexStrokeActive: "black",
                vertexStrokeInactive: "#ffd0d0",
                vertexStrokeHover: "#88ff88",
                vertexFillHover: "#88ff88",
                vertexFillDefault: "none",
            },
            client: client,
            model: model,
            propNames: Object.keys(clientDefault.props),
            propInfo: function(id) {
                return propInfo[id];
            },
            syncModel: function(data) {
                if (client) {
                    if (data.hasOwnProperty("client")) {
                        console.log(model.name + "overriding saved client");
                        delete data.client;
                    }
                }
                JsonUtil.applyJson(model, data);
                if (!client) {
                    if (model.client) {
                        console.log(model.name + ":" + "restored saved client");
                        client = model.client;
                        client.props = client.props || JSON.parse(JSON.stringify(clientDefault)).props;
                    } else {
                        console.log(model.name + ":" + "initializing client to default");
                        client = JSON.parse(JSON.stringify(clientDefault));;
                    }
                }
                service.client = model.client = client;
                service.validate();
                return model;
            },
            getSyncJson: function() {
                if (client) {
                    // remove legacy fields
                    delete client.type;
                    delete client.zMax;
                    delete client.zMin;
                    delete client.rIn;
                    delete client.zPlanes;
                    delete client.maxLevel;
                    delete client.properties;
                }
                return service.model;
            },
            scan: {
                active: false,
                buttonClass: function() {
                    return service.scan.active ? "btn-warning" : "";
                },
                onClick: function() {
                    service.scan.active = true;
                    alerts.taskBegin();
                    var camName = camera.model.selected;
                    var url = "/mesh/" + camName + "/scan";
                    var postData = model.client;
                    $http.post(url, postData).success(function(response, status, headers, config) {
                        console.log("mesh-service.scan(" + camName + ") ", response);
                        service.saveCount++;
                        alerts.taskEnd();
                        service.scan.active = false;
                    }).error(function(err, status, headers, config) {
                        console.warn("mesh-service.scan(" + camName + ") failed HTTP" + status, err);
                        alerts.taskEnd();
                        service.scan.active = false;
                    });
                }
            },
            validate: function() {
                var mesh = service.mesh;
                var config = model.config;
                if (mesh == null ||
                    mesh.rIn !== config.rIn ||
                    mesh.zMin !== config.zMin ||
                    mesh.zPlanes !== config.zPlanes) {
                    mesh = service.mesh = new DeltaMesh(config);
                }
                var nLevels = mesh.zPlanes - 2;
                config.maxLevel = Math.min(nLevels,
                    config.maxLevel == null ? nLevels - 1 : config.maxLevel);
                service.levels = [];
                for (var i = 0; i++ < nLevels;) {
                    service.levels.push(i);
                }
                var opts = {
                    maxLevel: config.maxLevel,
                    includeExternal: false,
                };
                service.vertices = mesh.zPlaneVertices(0, opts);
                console.log("validate() created mesh vertices:", service.vertices.length);

                return service;
            },
            mouse: {
            },
            onMouseMove: function(evt) {
                var elt = $document.find('svg').parent()[0];
                var cx = elt.offsetWidth/2;
                var cy = elt.offsetHeight/2;
                var dx = 0;
                var dy = 0;
                for (var op = elt; op != null; op = op.offsetParent) {
                    dx += op.offsetLeft;
                    dy += op.offsetTop;
                }
                var mouse = service.mouse;
                mouse.x = evt.clientX + document.body.scrollLeft + document.documentElement.scrollLeft - dx;
                mouse.y = evt.clientY + document.body.scrollTop + document.documentElement.scrollTop - dy;
                mouse.x = cx - mouse.x;
                mouse.y = mouse.y - cy;
                var dMax = 5;
                for (var i=service.vertices.length; i-->0; ){
                    var v = service.vertices[i];
                    if (v == null) {
                        continue;
                    }
                    if (Math.abs(v.x - mouse.x) < dMax && Math.abs(v.y - mouse.y) < dMax) { 
                        service.mouse.vertex = v;
                        break;
                    }
                }
            },
            vertexRadius: function(v) {
                return 4;
            },
            vertexStroke: function(v) {
                if (DeltaMesh.isVertexROI(v, client.roi)) {
                    if (service.mouse && (v === service.mouse.vertex)) {
                        return service.color.vertexStrokeHover;
                    } else {
                        return service.color.vertexStrokeActive;
                    }
                } else {
                    return service.color.vertexStrokeInactive;
                }
            },
            vertexFill: function(v) {
                if (service.mouse == null || service.mouse.x == null || service.mouse.y == null) {
                    return service.color.vertexFillDefault;
                }
                if (service.mouse && (v === service.mouse.vertex)) {
                    return service.color.vertexFillHover;
                }
                return service.color.vertexFillDefault;
            },
            create: function() {
                var config = model.config;
                service.mesh = null;
                service.validate();
                config.rIn = service.mesh.rIn;

                alerts.taskBegin();
                var url = "/mesh/create";
                $http.post(url, config).success(function(response, status, headers, config) {
                    console.log("mesh-service.create() ", response);
                    service.saveCount++;
                    alerts.taskEnd();
                }).error(function(err, status, headers, config) {
                    console.warn("mesh-service.create() failed HTTP" + status, err);
                    alerts.taskEnd();
                });
            },
            onChangeLevel: function() {
                service.validate();
            },
        };

        return service;
    }
]);
