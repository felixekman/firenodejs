var child_process = require('child_process');
var JsonUtil = require("../../www/js/shared/JsonUtil");
var JsonError = require("../../www/js/shared/JsonError");
var PonokoSvg = require("../../www/js/shared/PonokoSvg");
var DeltaMesh = require("../../www/js/shared/DeltaMesh");
var XYZ = require("../../www/js/shared/XYZ");
var Stats = require("../../www/js/shared/Stats");
var RestClient = require("../RestClient");
var path = require("path");
var fs = require("fs");

(function(exports) {
    ///////////////////////// private instance variables

    ////////////////// constructor
    function MeshREST(images, firesight, options) {
        var that = this;
        options = options || {};

        that.serviceBus = options.serviceBus;
        that.model = {
            available: true,
            grid: {
                cellW: 4, // mm
                cellH: 4, // mm
            }
        };
        if ((that.images = images) == null) throw new Error("images is required");
        if ((that.firesight = firesight) == null) throw new Error("firesight is required");
        if ((that.firestep = images.firestep) == null) throw new Error("firestep is required");
        if ((that.camera = images.camera) == null) throw new Error("camera is required");;
        that.model.rest = "MeshREST";
        that.serviceBus && that.serviceBus.onAfterUpdate(function() {
            that.applyMeshConfig();
        });
        that.precision = options.precision == null ? 3 : options.precision
        that.precisionScale = Math.pow(10, that.precision);

        that.model.config = {
            type: "DeltaMesh",
            zMax: 60,
            zMin: -50,
            rIn: 195,
            zPlanes: 7,
            maxLevel: 5,
        }

        return that;
    }

    MeshREST.prototype.isAvailable = function() {
        var that = this;
        return that.model.rest === "MeshREST";
    }
    MeshREST.prototype.applyMeshConfig = function(config) {
        var that = this;
        config = config || that.model.config;
        if (that.mesh == null ||
            that.mesh.zMax != config.zMax ||
            that.mesh.zMin != config.zMin ||
            that.mesh.rIn != config.rIn ||
            that.mesh.zPlanes != config.zPlanes) {
            that.mesh = new DeltaMesh(config);
            console.log("INFO\t: MeshREST.applyMeshConfig() mesh cleared and reconfigured");
            return true; // new mesh
        }
        return false; // no change
    }
    MeshREST.prototype.rest_mend = function(reqBody, onSuccess, onFail) {
        var that = this;
        var props = reqBody && reqBody.props;
        if (props == null) {
            var err = new Error("MeshREST.rest_mend: expected props:Array");
            onFail(err);
            return err;
        }
        var result = {
            mended: {}
        };
        var options = {
            roi: reqBody.roi,
        }
        var mesh = that.mesh;
        var scanPlanes = that.model.client.scanPlanes;

        for (var i = 0; i < props.length; i++) {
            var propName = props[i];
            if (propName === "gcw" || propName === "gch") {
                scanPlanes && scanPlanes[0] &&
                    (result.mended[propName] = mesh.mendZPlane(0, propName, options).length);
                scanPlanes && scanPlanes[1] &&
                    (result.mended[propName] = mesh.mendZPlane(1, propName, options).length);
            }
        }

        that.saveMesh();
        onSuccess(result);
        return that;
    }
    MeshREST.prototype.calcProp = function(v, propName, gcwMean, gchMean) {
        var that = this;
        var z1 = v.z;
        var mesh = that.mesh;
        var zpi1 = mesh.zPlaneIndex(z1);
        var zpi2 = zpi1 === 0 ? 1 : zpi1 - 1;
        var z2 = mesh.zPlaneZ(zpi2);
        var count = 0;

        delete v[propName];
        if (propName === "dgcw") {
            var val1 = v.gcw;
            var val2 = mesh.interpolate(new XYZ(v.x, v.y, z2), "gcw");
            if (!isNaN(val1) && !isNaN(val2)) {
                var dgcw = (val1 - val2);
                v[propName] = JsonUtil.round(dgcw, that.precisionScale);
                count++;
            }
        } else if (propName === "dgch") {
            var val1 = v.gch;
            var val2 = mesh.interpolate(new XYZ(v.x, v.y, z2), "gch");
            if (!isNaN(val1) && !isNaN(val2)) {
                var dgch = (val1 - val2);
                v[propName] = JsonUtil.round(dgch, that.precisionScale);
                count++;
            }
        } else if (propName === "ezw") {
            count++;
            v.ezw = JsonUtil.round(((v.gcw - that.model.gcwMean) * that.model.zmmPerW), that.precisionScale);
        } else if (propName === "ezh") {
            count++;
            v.ezh = JsonUtil.round(((v.gch - that.model.gchMean) * that.model.zmmPerH), that.precisionScale);
        } else if (propName === "xyp") {
            var n = 0;
            var sum = 0;
            if (v.ox != null && v.gcw != null) {
                n++;
                var xmm = v.ox * that.model.grid.cellW / v.gcw;
                sum += xmm * xmm;
            }
            if (v.oy != null && v.gch != null) {
                n++;
                var ymm = v.oy * that.model.grid.cellH / v.gch;
                sum += ymm * ymm;
            }
            if (n) {
                count++;
                var rms = Math.sqrt(sum / n);
                v.xyp = JsonUtil.round(rms, that.precisionScale);
            }
        }
        return count;
    }
    MeshREST.prototype.rest_calcProps = function(reqBody, onSuccess, onFail) {
        var that = this;
        var result = {
            count: {},
        };
        var msStart = new Date();
        var isCalc = {};
        var propNames = reqBody && reqBody.props;
        for (var ip = 0; ip < propNames.length; ip++) {
            var propName = propNames[ip];
            result.count[propName] = 0;
            isCalc[propName] = true;
        }

        // PASS #1: calculate cell width/height
        var mesh = that.mesh;
        var data = that.model.config.data;
        var sumP = 0;
        for (var i = data.length; i-- > 0;) {
            var d = data[i];
            var v = mesh.vertexAtXYZ(d);
            if (v != null) {
                (isCalc.dgcw || isCalc.xyp) && (result.count.dgcw += that.calcProp(v, "dgcw"));
                (isCalc.dgch || isCalc.xyp) && (result.count.dgch += that.calcProp(v, "dgch"));
            }
        }
        console.log("INFO\t: MeshREST.rest_calcProps() pass1_ms:", (new Date() - msStart));

        // PASS #2: calculate ezw, ezh, xyp
        msStart = new Date();
        if (isCalc.dgcw || isCalc.dgcH || isCalc.xyp) {
            var stats = new Stats();
            var coreVertices = mesh.zPlaneVertices(0, {
                roi: {
                    type: "rect",
                    cx: 0,
                    cy: 0,
                    width: 55, // use core vertices for highest accuracy
                    height: 55, // use core vertices for highest accuracy
                }
            });
            var z01 = mesh.zPlaneHeight(0);
            that.model.zmmPerW = -z01 / stats.calcProp(coreVertices, "dgcw").mean;
            that.model.zmmPerH = -z01 / stats.calcProp(coreVertices, "dgch").mean;
            that.model.gcwMean = stats.calcProp(coreVertices, "gcw").mean;
            that.model.gchMean = stats.calcProp(coreVertices, "gch").mean;
            that.model.xmmPerPixel = that.model.grid.cellW / that.model.gcwMean;
            that.model.ymmPerPixel = that.model.grid.cellH / that.model.gchMean;
            for (var i = data.length; i-- > 0;) {
                var d = data[i];
                var v = mesh.vertexAtXYZ(d);
                if (v) {
                    result.count.ezw += that.calcProp(v, "ezw");
                    result.count.ezh += that.calcProp(v, "ezh");
                    isCalc.xyp && (result.count.xyp += that.calcProp(v, "xyp"));
                }
            }
        }
        console.log("INFO\t: MeshREST.rest_calcProps() pass2_ms:", (new Date() - msStart));

        msStart = new Date();
        that.saveMesh();
        console.log("INFO\t: MeshREST.rest_calcProps() saveMesh_ms:", (new Date() - msStart));
        onSuccess(result);
        return that;
    }
    MeshREST.prototype.rest_ponoko_p1_corner_holes = function(reqBody, onSuccess, onFail) {
        const that = this;
        var roi = reqBody.roi;
        var options = {
            roi: roi,
        }
        var svg = new PonokoSvg({
            units: "mm",
            width: roi.width,
            height: roi.height,
        });
        svg.addFrame({
            rx: reqBody.rx || 3,
            ry: reqBody.ry || 3,
        });
        var xSep = (reqBody.xSep || 170);
        var ySep = (reqBody.ySep || 170);
        var r = reqBody.hole || 1.5; // M3
        var circleOpts = {
            stroke: PonokoSvg.STROKE_CUT,
        };
        svg.addCircle(-xSep/2, -ySep/2, r, circleOpts);
        svg.addCircle(xSep/2, -ySep/2, r, circleOpts);
        svg.addCircle(-xSep/2, ySep/2, r, circleOpts);
        svg.addCircle(xSep/2, ySep/2, r, circleOpts);
        var path = "/var/firenodejs/svg/";
        var file = "p1-corner-holes.svg";
        var s = svg.serialize();
        fs.writeFile(path+file, s, function(err) {
            if (err instanceof Error) {
                onFail(err);
                throw err;
            }
            onSuccess("/var/svg/" + file);
        });
        return that;
    }
    MeshREST.prototype.rest_ponoko_p1_xygrid = function(reqBody, onSuccess, onFail) {
        const that = this;
        var roi = reqBody.roi;
        var options = {
            roi: roi,
        }
        var svg = new PonokoSvg({
            units: "mm",
            width: roi.width,
            height: roi.height,
        });
        svg.addFrame({
            rx: reqBody.rx || 3,
            ry: reqBody.ry || 3,
        });
        var xSep = (reqBody.xSep || 170);
        var ySep = (reqBody.ySep || 170);
        var r = reqBody.hole || 1.5; // M3
        var circleOpts = {
            stroke: PonokoSvg.STROKE_CUT,
        };
        svg.addCircle(-xSep/2, -ySep/2, r, circleOpts);
        svg.addCircle(xSep/2, -ySep/2, r, circleOpts);
        svg.addCircle(-xSep/2, ySep/2, r, circleOpts);
        svg.addCircle(xSep/2, ySep/2, r, circleOpts);
        var p1w = 181;
        var p1h = 181;
        var tick = 6;
        svg.addLine(0, -p1h/2+1, 0, -p1h/2+tick);
        svg.addLine(0, p1h/2-1, 0, p1h/2-tick);
        svg.addLine(-p1w/2+1, 0, -p1w/2+tick, 0);
        svg.addLine(p1w/2-1, 0, p1w/2-tick, 0);
        svg.addLine(-tick/2, 0, tick/2, 0);
        svg.addLine(0, -tick/2, 0, tick/2);
        svg.addFrame({
            rx: 3,
            ry: 3,
        });
        var svgVertices = that.mesh.zPlaneVertices(0, options);
        var xb = 20; // extrusion base
        var dx = xSep/2 - 4;
        var dy = ySep/2 - 4;
        for (var i=0; i < svgVertices.length; i++) {
            var v = svgVertices[i];
            if (-dx<=v.x && v.x<=dx || -dy<=v.y && v.y<=dy) {
                svg.addCrashDummySymbol(v.x, v.y, {
                    height: 6,
                    labelBottom: JsonUtil.round(v.x,1) + "," + JsonUtil.round(v.y,1)
                });
            }
        }
        var path = "/var/firenodejs/svg/";
        var file = "p1-xygrid.svg";
        var s = svg.serialize();
        fs.writeFile(path+file, s, function(err) {
            if (err instanceof Error) {
                onFail(err);
                throw err;
            }
            onSuccess("/var/svg/" + file);
        });
        return that;
    }
    MeshREST.prototype.rest_configure = function(reqBody, onSuccess, onFail) {
        var that = this;
        var changed = that.applyMeshConfig();
        that.model.config = reqBody;
        onSuccess(config);
        return that;
    }
    MeshREST.prototype.calcOffset = function(result, camName, scanRequest, next, onFail) {
        var that = this;
        var props = scanRequest.props;
        var maxError = scanRequest.maxError;
        var rest = new RestClient();
        rest.get("/firesight/" + camName + "/calc-offset", function(data) {
            that.verbose && verboseLogger.debug("INFO\t: MeshREST.calcOffset(" + camName + ") data:", data);
            result.summary += data.summary + "; ";
            var xOk = data.dx != null;
            var yOk = data.dy != null;
            (props.xyp || props.ox) && updateResultProp(result, "ox", data, "dx", xOk);
            (props.xyp || props.oy) && updateResultProp(result, "oy", data, "dy", yOk);
            next();
        }, onFail);
    }
    MeshREST.prototype.calcGrid = function(result, camName, scanRequest, next, onFail) {
        var that = this;
        var props = scanRequest.props;
        var maxError = scanRequest.maxError;
        var rest = new RestClient();
        rest.get("/firesight/" + camName + "/calc-grid", function(gridData) {
            that.verbose && verboseLogger.debug("INFO\t: MeshREST.gatherData(" + camName + ") gridData:", gridData);
            result.summary += gridData.summary + "; ";
            var xOk = gridData.rmse != null && isResultAccurate(result, "rmse.x", gridData.rmse.x, maxError);
            var yOk = gridData.rmse != null && isResultAccurate(result, "rmse.y", gridData.rmse.y, maxError);
            props.gcw && updateResultProp(result, "gcw", gridData.cellSize, "w", xOk);
            props.gch && updateResultProp(result, "gch", gridData.cellSize, "h", yOk);
            props.ga && updateResultProp(result, "ga", gridData, "angle", xOk && yOk);
            props.gex && updateResultProp(result, "gex", gridData.rmse, "x", gridData.rmse && gridData.rmse.x != null);
            props.gey && updateResultProp(result, "gey", gridData.rmse, "y", gridData.rmse && gridData.rmse.y != null);
            result.vertex.summary = result.data.summary = result.summary;
            next();
        }, onFail);
    }
    MeshREST.prototype.saveMesh = function() {
        var that = this;
        that.model.config = that.mesh.export();
        that.model.config.data.sort(function(a, b) {
            var cmp = a.x - b.x;
            cmp === 0 && (cmp = a.y - b.y);
            cmp === 0 && (cmp = a.z - b.z);
            return cmp;
        });
        that.serviceBus && that.serviceBus.emitSaveModels();
        return that;
    }
    MeshREST.prototype.gatherData = function(result, camName, scanRequest, onSuccess, onFail) {
        var that = this;
        var props = scanRequest.props;
        var scanCalcGrid = function(next) {
            if (props == null || props.gcw || props.gch || props.ga || props.gex || props.gey) {
                that.calcGrid(result, camName, scanRequest, next, onFail);
            } else {
                next();
            }
        }
        var scanCalcOffset = function(next) {
            if (props == null || props.ox || props.oy || props.xyp) {
                that.calcOffset(result, camName, scanRequest, next, onFail);
            } else {
                next();
            }
        }
        var gatherEnd = function() {
            that.saveMesh();
            onSuccess(result);
        }
        scanCalcOffset(function() {
            JsonUtil.applyJson(result.vertex, result.data);
            scanCalcGrid(function() {
                JsonUtil.applyJson(result.vertex, result.data);
                gatherEnd();
            });
        });
    }
    MeshREST.prototype.rest_scan_vertex = function(camName, postData, onSuccess, onFail) {
        var that = this;
        try {
            var rest = new RestClient();
            var v = that.mesh.vertexAtXYZ(postData.pt, {
                snapDistance: postData.snapDistance || 1,
            });
            v.should.exist;
            var result = {
                vertex: v,
                data: {},
                summary: "",
            }
            rest.post("/firestep", [{
                mov: {
                    x: v.x,
                    y: v.y,
                    z: v.z,
                },
                //dpyds: 12,
            }], function(movResponse) {
                console.log("INFO\t: MeshREST.scan(" + camName + ") vertex:", v);
                that.gatherData(result, camName, postData, function() {
                    that.serviceBus && that.serviceBus.emitSaveModels();
                    onSuccess(result);
                }, function(e) {
                    console.log("WARN\t: MeshREST.rest_scan_vertex(" + JSON.stringify(v) + ") move failed:" + e.message, "stack:", e.stack);
                    onFail(e);
                });
            }, function(e) {
                console.log("WARN\t: MeshREST.rest_scan_vertex(" + JSON.stringify(v) + ") move failed:" + e.message, "stack:", e.stack);
                onFail(e);
            });
        } catch (e) {
            console.log("WARN\t: MeshREST.rest_scan_vertex() caught exception:" + e.message, "stack:", e.stack);
            onFail(e);
        }
    }
    var updateResultProp = function(result, dstKey, src, srcKey, isValid) {
        delete result.vertex[dstKey]; // remove existing value
        if (isValid) {
            if (src == null || src[srcKey] == null) {
                result.summary += dstKey + ":n/a; ";
            } else {
                result.vertex[dstKey] = result.data[dstKey] = src[srcKey];
            }
        }
    }
    var isResultAccurate = function(result, dstKey, error, maxError) {
        if (maxError == null) {
            return true;
        }
        if (error == null) {
            result.summary += dstKey + ":n/a; ";
            return false;
        }
        if (error > maxError) {
            result.summary += dstKey + ":" + error + ">maxError); ";
            return false;
        }
        return true;
    }

    module.exports = exports.MeshREST = MeshREST;
})(typeof exports === "object" ? exports : (exports = {}));
