"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolver = exports.IS_NOT_INTRINSIC = exports.deepFreeze = exports.clone = exports.ident = void 0;
/** Identity function */
function ident(arg) {
    return arg;
}
exports.ident = ident;
/**
 * Performs a structured clone, ignoring non-enumerable properties such as
 * functions.
 */
function clone(arg) {
    // TODO: replace ugly hack with better cloning
    return arg === undefined ? undefined : JSON.parse(JSON.stringify(arg));
}
exports.clone = clone;
function deepFreeze(arg) {
    for (const prop of Object.getOwnPropertyNames(arg)) {
        // deno-lint-ignore no-explicit-any
        const value = arg[prop];
        if (typeof value === "object" && value !== null)
            deepFreeze(value);
    }
    return Object.freeze(arg);
}
exports.deepFreeze = deepFreeze;
// Define which context properties are intrinsic to grammY or this plugin and
// should not be stored in the op logs
const INTRINSIC_CONTEXT_PROPS = new Set([
    "update",
    "api",
    "me",
    "conversation",
]);
function IS_NOT_INTRINSIC(key) {
    return !INTRINSIC_CONTEXT_PROPS.has(key);
}
exports.IS_NOT_INTRINSIC = IS_NOT_INTRINSIC;
/** Creates a new resolver */
function resolver(value) {
    const rsr = { value, isResolved: () => false };
    rsr.promise = new Promise((resolve) => {
        rsr.resolve = (t = value) => {
            if (t === undefined)
                throw new Error("No resolve value given!");
            rsr.isResolved = () => true;
            rsr.value = t;
            resolve(t);
        };
    });
    return rsr;
}
exports.resolver = resolver;
