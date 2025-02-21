"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _a;
var _b, _c;
exports.__esModule = true;
exports.logger = void 0;
var winston = require("winston");
var dotenv_1 = require("dotenv");
(0, dotenv_1.configDotenv)();
var logFormat = winston.format.printf(function (info) {
    var _a, _b;
    return "".concat(info.timestamp, " ").concat(info.level, " [").concat((_a = info.metadata.module) !== null && _a !== void 0 ? _a : "", ":").concat((_b = info.metadata.method) !== null && _b !== void 0 ? _b : "", "]: ").concat(info.message, " ").concat(info.level.includes("error") || info.level.includes("warn")
        ? JSON.stringify(info.metadata, function (_, value) {
            if (value instanceof Error) {
                return __assign(__assign({}, value), { name: value.name, message: value.message, stack: value.stack, cause: value.cause });
            }
            else {
                return value;
            }
        })
        : "");
});
exports.logger = winston.createLogger({
    level: (_c = (_b = process.env.LOGGING_LEVEL) === null || _b === void 0 ? void 0 : _b.toLowerCase()) !== null && _c !== void 0 ? _c : "debug",
    format: winston.format.json({
        replacer: function (key, value) {
            if (value instanceof Error) {
                return __assign(__assign({}, value), { name: value.name, message: value.message, stack: value.stack, cause: value.cause });
            }
            else {
                return value;
            }
        }
    }),
    transports: __spreadArray(__spreadArray([], (process.env.FIRECRAWL_LOG_TO_FILE
        ? [
            new winston.transports.File({
                filename: "firecrawl-" +
                    (process.argv[1].includes("worker") ? "worker" : "app") +
                    "-" +
                    crypto.randomUUID() +
                    ".log"
            }),
        ]
        : []), true), [
        new winston.transports.Console({
            format: (_a = winston.format).combine.apply(_a, __spreadArray([winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
                winston.format.metadata({
                    fillExcept: ["message", "level", "timestamp"]
                })], ((process.env.ENV === "production" &&
                process.env.SENTRY_ENVIRONMENT === "dev") ||
                process.env.ENV !== "production"
                ? [winston.format.colorize(), logFormat]
                : []), false))
        }),
    ], false)
});
