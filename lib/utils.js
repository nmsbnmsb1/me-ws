"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defer = defer;
function defer() {
    const defer = {};
    defer.promise = new Promise((resolve, reject) => {
        defer.resolve = resolve;
        defer.reject = reject;
    });
    return defer;
}
//# sourceMappingURL=utils.js.map