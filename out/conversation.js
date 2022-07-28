"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationHandle = exports.createConversation = exports.conversations = void 0;
const deps_node_js_1 = require("./deps.node.js");
const utils_js_1 = require("./utils.js");
/**
 * Used to store data invisibly on context object inside the conversation
 * control panel
 */
const internal = Symbol("conversations");
/**
 * The is the conversation control panel which is available on
 * `ctx.conversation`. It allows you to enter and exit conversations, and to
 * inspect which conversation is currently active.
 */
class ConversationControls {
    constructor(session) {
        this.session = session;
        /** List of all conversations to be started */
        this[_a] = { ids: new Set() };
    }
    /**
     * Returns a map of the identifiers of currently active conversations to the
     * number of times this conversation is active in the current chat. For
     * example, you can use `"captcha" in ctx.conversation.active` to check if
     * there are any active conversations in this chat with the identifier
     * `"captcha"`.
     */
    get active() {
        var _b, _c;
        return Object.fromEntries(Object.entries((_c = (_b = this.session) === null || _b === void 0 ? void 0 : _b.conversation) !== null && _c !== void 0 ? _c : {})
            .map(([id, conversations]) => [id, conversations.length]));
    }
    /**
     * Enters a conversation with the given identifier.
     *
     * Note that this method is async. You must `await` this method.
     */
    enter(id, _opts = {}) {
        // Each installed conversation will wrap this function and intercept the
        // call chain for their own identifier, so if we are actually called, an
        // unknown identifier was passed. Hence, we simply throw an error.
        const known = Array.from(this[internal].ids.values())
            .map((id) => `'${id}'`)
            .join(", ");
        throw new Error(`The conversation '${id}' has not been registered! Known conversations are: ${known}`);
    }
    /**
     * Kills all conversations with the given identifier (if any) and enters a
     * new conversation for this identifier. Equivalent to passing `overwrite:
     * true` to `enter`.
     *
     * Note that this method is async. You must `await` this method.
     */
    reenter(id) {
        this.enter(id, { overwrite: true });
    }
    /**
     * Hard-kills all conversations for a given identifier. Note that the normal
     * way for conversations to exit is for their conversation builder function
     * to complete (return or throw).
     *
     * If no identifier is specified, all running conversations of all
     * identifiers will be killed.
     */
    exit(id) {
        const s = this.session;
        if ((s === null || s === void 0 ? void 0 : s.conversation) === undefined)
            return;
        if (id === undefined) {
            // Simply clear all conversation data
            delete s.conversation;
        }
        else {
            // Strip out specified conversations from active ones
            delete s.conversation[id];
            // Do not store empty array
            if (Object.keys(s.conversation).length === 0)
                delete s.conversation;
        }
    }
}
_a = internal;
/**
 * Creates a runner function which is in turn able to execute conversation
 * builder functions based on an op log.
 */
function conversationRunner(ctx, builder) {
    /**
     * Adds an entry for the current context object to the given log,
     * effectively turning the most recent wait op into a old wait which will be
     * replayed
     */
    function receiveUpdate(log) {
        // Need to log both update (in `update`) and all enumerable
        // properties on the context object (in `extra`).
        const extra = Object.fromEntries(Object.entries(ctx)
            // Do not copy over intrinsic properties
            .filter(([k]) => (0, utils_js_1.IS_NOT_INTRINSIC)(k))
            .map(([k, v]) => [k, (0, utils_js_1.clone)(v)]));
        // Do not store old session data, removing a lot of unused data
        delete extra.session.conversation;
        log.u.push({ u: ctx.update, x: extra });
    }
    /**
     * Defines how to run a conversation builder function. Returns `false` if
     * the conversation decided to pass on the control flow, and `true` if it
     * handled the update, i.e. completed normally or via a wait call. Note that
     * this function re-throws errors thrown by the conversation.
     */
    async function run(log) {
        var _b;
        // We are either starting the conversation builder function from
        // scratch, or we are beginning a replay operation. In both cases, the
        // current context object is new to the conversation builder function,
        // be it the inital context object or the result of a `wait` call.
        // Hence, we should log the current context object.
        receiveUpdate(log);
        // Now, we invoke the conversation builder function.
        const rsr = (0, utils_js_1.resolver)(); // used to catch `wait` calls
        const handle = new ConversationHandle(ctx, log, rsr);
        // Replay the initial context object manually
        const initialContext = handle._replayWait();
        // Call the target builder function supplied by the user, but
        // don't blindly await it because when `wait` is called
        // somewhere inside, execution is aborted. The `Promise.race`
        // intercepts this again and allows us to resume normal
        // middleware handling.
        try {
            await Promise.race([rsr.promise, builder(handle, initialContext)]);
        }
        finally {
            handle._deactivate();
        }
        return (_b = rsr.value) !== null && _b !== void 0 ? _b : "done";
    }
    return run;
}
function conversations() {
    return async (ctx, next) => {
        var _b;
        if (ctx.session === undefined) {
            throw new Error("Cannot use conversations without session!");
        }
        (_b = ctx.conversation) !== null && _b !== void 0 ? _b : (ctx.conversation = new ConversationControls(ctx.session));
        await next();
    };
}
exports.conversations = conversations;
/**
 * Takes a conversation builder function, and turns it into grammY middleware
 * which can be installed on your bot. Check out the
 * [documentation](https://grammy.dev/plugins/conversations.html) to learn more
 * about how conversation builder functions can be created.
 *
 * @param builder Conversation builder function
 * @param id Identifier of the conversation, defaults to `builder.name`
 * @returns Middleware to be installed on the bot
 */
function createConversation(builder, id = builder.name) {
    if (!id)
        throw new Error("Cannot register a function without name!");
    return async (ctx, next) => {
        var _b;
        if (ctx.conversation === undefined) {
            throw new Error("Cannot register a conversation without first installing the conversations plugin!");
        }
        // Add ourselves to the conversation index
        const index = ctx.conversation[internal].ids;
        if (index.has(id)) {
            throw new Error(`Duplicate conversation identifier '${id}'!`);
        }
        index.add(id);
        // Define how to run a conversation builder function
        const runOnLog = conversationRunner(ctx, builder);
        /**
         * Runs our conversation builder function for all given logs in
         * ascending order until the first decides to handle the update.
         */
        async function runUntilComplete(conversations) {
            let op = "skip";
            for (let i = 0; op === "skip" && i < conversations.length; i++) {
                const current = conversations[i];
                try {
                    op = await runOnLog(current.log);
                }
                catch (e) {
                    conversations.splice(i, 1);
                    throw e;
                }
                if (op === "done")
                    conversations.splice(i, 1);
            }
            return op;
        }
        // Register ourselves in the enter function
        const oldEnter = ctx.conversation.enter.bind(ctx.conversation);
        ctx.conversation.enter = async (enterId, opts) => {
            var _b, _c;
            var _d, _e;
            if (enterId !== id) {
                await oldEnter(enterId, opts);
                return;
            }
            (_b = (_d = ctx.session).conversation) !== null && _b !== void 0 ? _b : (_d.conversation = {});
            const entry = { log: { u: [] } };
            const append = [entry];
            if (opts === null || opts === void 0 ? void 0 : opts.overwrite)
                ctx.session.conversation[id] = append;
            else
                ((_c = (_e = ctx.session.conversation)[id]) !== null && _c !== void 0 ? _c : (_e[id] = [])).push(...append);
            const pos = ctx.session.conversation[id].length - 1;
            try {
                await runUntilComplete(append);
            }
            finally {
                if (append.length === 0) {
                    ctx.session.conversation[id].splice(pos, 1);
                }
                if (ctx.session.conversation[id].length === 0) {
                    delete ctx.session.conversation[id];
                }
            }
        };
        try {
            // Run all existing conversations with our identifier
            let op = "skip";
            if (((_b = ctx.session.conversation) === null || _b === void 0 ? void 0 : _b[id]) !== undefined) {
                try {
                    op = await runUntilComplete(ctx.session.conversation[id]);
                }
                finally {
                    // Clean up if no logs remain
                    if (ctx.session.conversation[id].length === 0) {
                        delete ctx.session.conversation[id];
                    }
                }
            }
            // If all ran conversations (if any) called skip as their last op, we
            // run the downstream middleware
            if (op === "skip")
                await next();
        }
        finally {
            // Clean up if no conversations remain
            if (ctx.session.conversation !== undefined &&
                Object.keys(ctx.session.conversation).length === 0) {
                delete ctx.session.conversation;
            }
        }
    };
}
exports.createConversation = createConversation;
/**
 * Internally used class which acts as a conversation handle.
 */
class ConversationHandle {
    constructor(ctx, opLog, rsr) {
        this.ctx = ctx;
        this.opLog = opLog;
        this.rsr = rsr;
        this.replayIndex = { wait: 0 };
        this.active = true;
        // We intercept Bot API calls, returning logged responses while
        // replaying, and logging the responses of performed calls otherwise.
        ctx.api.config.use(async (prev, method, payload, signal) => {
            if (!this.active)
                return prev(method, payload, signal);
            // deno-lint-ignore no-explicit-any
            if (this._isReplaying)
                return this._replayApi(method);
            const slot = this._logApi(method);
            const result = await prev(method, payload, signal);
            slot.r = result;
            this._finalize(slot);
            return result;
        });
    }
    _deactivate() {
        this.active = false;
    }
    /**
     * Internal flag, `true` if the conversation is currently replaying in order
     * to jump back to an old state, and `false` otherwise. Relying on this can
     * lead to very funky things, so only use this flag if you absolutely know
     * what you are doing. Most likely, you should not use this at all.
     */
    get _isReplaying() {
        return this.replayIndex.wait < this.opLog.u.length;
    }
    /**
     * Internal method, retrieves the next logged wait operation from the stack
     * while replaying, and advances the replay cursor. Relying on this can lead
     * to very funky things, so only use this flag if you absolutely know what
     * you are doing. Most likely, you should not use this at all.
     */
    _replayWait() {
        if (!this._isReplaying) {
            throw new Error("Replay stack exhausted, you may not call this method!");
        }
        if (this.replayIndex.wait > 0) {
            // Previous session won't be saved anymore so we freeze it
            (0, utils_js_1.deepFreeze)(this.opLog.u[this.replayIndex.wait - 1].x.session);
        }
        const { u, x } = this.opLog.u[this.replayIndex.wait];
        this.replayIndex = { wait: 1 + this.replayIndex.wait };
        // Return original context if we're about to resume execution
        if (!this._isReplaying)
            return this.ctx;
        // Create fake context, and restore all enumerable properties
        return Object.assign(new deps_node_js_1.Context(u, this.ctx.api, this.ctx.me), x);
    }
    _replayApi(method) {
        var _b, _c, _d, _e;
        var _f;
        let index = (_b = this.replayIndex.api) === null || _b === void 0 ? void 0 : _b.get(method);
        if (index === undefined) {
            index = 0;
            (_c = (_f = this.replayIndex).api) !== null && _c !== void 0 ? _c : (_f.api = new Map());
            this.replayIndex.api.set(method, index);
        }
        const result = (_d = this.opLog.u[this.replayIndex.wait - 1].a) === null || _d === void 0 ? void 0 : _d[method][index];
        (_e = this.replayIndex.api) === null || _e === void 0 ? void 0 : _e.set(method, 1 + index);
        if (result === undefined) {
            return new Promise(() => { });
        }
        return this._resolveAt(result.i, result.r);
    }
    _replayExt() {
        var _b;
        let index = this.replayIndex.ext;
        if (index === undefined)
            this.replayIndex.ext = index = 0;
        const result = (_b = this.opLog.u[this.replayIndex.wait].e) === null || _b === void 0 ? void 0 : _b[index];
        this.replayIndex.ext = 1 + index;
        if (result === undefined)
            return new Promise(() => { });
        return this._resolveAt(result.i, result.r);
    }
    _logWait(op) {
        if (!this._isReplaying)
            this.replayIndex.wait++;
        this.opLog.u.push(op);
    }
    _unlogWait() {
        const op = this.opLog.u.pop();
        if (op === undefined)
            throw new Error("Empty log, cannot unlog!");
        if (!this._isReplaying)
            this.replayIndex.wait--;
        return op;
    }
    _logApi(method) {
        var _b, _c;
        var _d, _e;
        const index = this.replayIndex.wait;
        const slot = { i: -1 };
        ((_c = (_e = ((_b = (_d = this.opLog.u[index - 1]).a) !== null && _b !== void 0 ? _b : (_d.a = {})))[method]) !== null && _c !== void 0 ? _c : (_e[method] = [])).push(slot);
        return slot;
    }
    _logExt() {
        var _b;
        var _c;
        const index = this.replayIndex.wait;
        const slot = { i: -1 };
        ((_b = (_c = this.opLog.u[index - 1]).e) !== null && _b !== void 0 ? _b : (_c.e = [])).push(slot);
        return slot;
    }
    _finalize(slot) {
        var _b;
        var _c;
        slot.i = (_b = (_c = this.replayIndex).resolve) !== null && _b !== void 0 ? _b : (_c.resolve = 0);
        this.replayIndex.resolve++;
    }
    _resolveAt(index, value) {
        var _b, _c;
        var _d, _e;
        const r = (0, utils_js_1.resolver)(value);
        if (index < 0)
            return r.promise;
        (_b = (_d = this.replayIndex).resolve) !== null && _b !== void 0 ? _b : (_d.resolve = 0);
        ((_c = (_e = this.replayIndex).tasks) !== null && _c !== void 0 ? _c : (_e.tasks = []))[index] = r;
        while (this.replayIndex.tasks[this.replayIndex.resolve] !== undefined) {
            this.replayIndex.tasks[this.replayIndex.resolve].resolve();
            this.replayIndex.resolve++;
        }
        return r.promise;
    }
    /**
     * Waits for a new update (e.g. a message, callback query, etc) from the
     * user. Once received, this method returns the new context object for the
     * incoming update.
     */
    async wait() {
        // If this is an old wait, simply return the old context object
        if (this._isReplaying)
            return this._replayWait();
        // Notify the resolver so that we can catch the function interception
        // and resume middleware execution normally outside of the conversation
        this.rsr.resolve("wait");
        // Intercept function execution
        await new Promise(() => { }); // BOOM
        // deno-lint-ignore no-explicit-any
        return 0; // dead code
    }
    async waitUntil(predicate) {
        const ctx = await this.wait();
        if (!await predicate(ctx))
            await this.skip();
        return ctx;
    }
    async waitUnless(predicate) {
        return await this.waitUntil(async (ctx) => !await predicate(ctx));
    }
    async waitFor(query) {
        const predicate = (0, deps_node_js_1.matchFilter)(query);
        return await this.waitUntil(predicate);
    }
    async waitFrom(user) {
        const id = typeof user === "number" ? user : user.id;
        const predicate = (ctx) => { var _b; return ((_b = ctx.from) === null || _b === void 0 ? void 0 : _b.id) === id; };
        return await this.waitUntil(predicate);
    }
    // TODO: implement command matching
    // TODO: implement hears matching
    // TODO: implement callback, game, and inline query matching
    /**
     * Skips handling the update that was received in the last `wait` call. Once
     * called, the conversation resets to the last `wait` call, as if the update
     * had never been received. The control flow is passed on immediately, so
     * that downstream middleware can continue handling the update.
     *
     * Effectively, calling `await conversation.skip()` behaves as if this
     * conversation had not received the update at all.
     *
     * Make sure not to perform any actions between the last wait call and the
     * skip call. While the conversation rewinds its log internally, it does not
     * unsend messages that you sent between calling `wait` and calling `skip`.
     */
    async skip() {
        // We decided not to handle this update, so we purge the last wait
        // operation again. It also contains the log of all operations performed
        // since that wait. Hence, we effectively completely rewind the
        // conversation until before the update was received.
        this._unlogWait();
        // Notify the resolver so that we can catch the function interception
        // and resume middleware execution normally outside of the conversation
        this.rsr.resolve("skip");
        // Intercept function execution
        return await new Promise(() => { }); // BOOM
    }
    /**
     * Safely performs an operation with side-effects. You must use this to wrap
     * all communication with external systems that does not go through grammY,
     * such as database communication or calls to external APIs.
     *
     * This function will then make sure the operation is only performed once,
     * and not every time a message is handled by the conversation.
     *
     * It will need to be able to store the result value of this operation in
     * the session. Hence, it must store and load the result of the operation
     * according to your storage adapter. It is therefore best to only return
     * primitive values or POJOs. If you need to transform your data before it
     * can be stored, you can specify the `beforeStore` function. If you need to
     * transform your data after it was loaded, you can specify the `afterLoad`
     * function.
     *
     * @param op An external operation to perform
     * @returns The result of the operation
     */
    // deno-lint-ignore no-explicit-any
    async external(op) {
        if (typeof op === "function")
            op = { task: op };
        const { task, args = [], beforeStore = utils_js_1.ident, afterLoad = utils_js_1.ident, beforeStoreError = utils_js_1.ident, afterLoadError = utils_js_1.ident, } = op;
        // Return the old result if we are replaying
        if (this._isReplaying) {
            const result = await this._replayExt();
            if ("v" in result)
                return await afterLoad(result.v);
            else
                throw await afterLoadError(result.e);
        }
        // Otherwise, execute the task and log its result
        const slot = this._logExt();
        try {
            const result = await task(...args);
            const value = await beforeStore(result);
            slot.r = { v: value };
            return result;
        }
        catch (error) {
            const value = await beforeStoreError(error);
            slot.r = { e: value };
            throw error;
        }
        finally {
            this._finalize(slot);
        }
    }
    /**
     * Sleep for the specified number of milliseconds. You should use this
     * instead of your own sleeping function so that you don't block the
     * conversation while it is restoring a previous position.
     *
     * @param milliseconds The number of milliseconds to wait
     */
    async sleep(milliseconds) {
        if (this._isReplaying)
            return;
        await new Promise((r) => setTimeout(r, milliseconds));
    }
    /**
     * Safely generates a random number from `Math.random()`. You should use
     * this instead of `Math.random()` in your conversation because
     * non-deterministic behavior is not allowed.
     *
     * @returns A random number
     */
    random() {
        return this.external({ task: () => Math.random() });
    }
    /**
     * Safely perform `console.log` calls, but only when they should really be
     * logged (so not during replay operations).
     *
     * @param args Arguments to pass to `console.log`
     */
    log(...args) {
        if (!this._isReplaying)
            console.log(...args);
    }
}
exports.ConversationHandle = ConversationHandle;
