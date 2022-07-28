import { type ApiResponse, Context, type Filter, type FilterQuery, type MiddlewareFn, type RawApi, type SessionFlavor, type Update, type User } from "./deps.node.js";
import { type Resolver } from "./utils.js";
/**
 * A user-defined builder function that can be turned into middleware for a
 * conversation.
 */
declare type ConversationBuilder<C extends Context> = (conversation: Conversation<C>, ctx: C) => unknown | Promise<unknown>;
/**
 * Context flavor for the conversations plugin. Adds the conversation control
 * panel `ctx.conversation` which e.g. allows entering a conversation. It also
 * adds some properties to the session which the conversation plugin needs.
 */
export declare type ConversationFlavor = {
    conversation: ConversationControls;
} & SessionFlavor<ConversationSessionData>;
interface Internals {
    /** Known conversation identifiers, used for collision checking */
    ids: Set<string>;
}
/**
 * Used to store data invisibly on context object inside the conversation
 * control panel
 */
declare const internal: unique symbol;
/**
 * The is the conversation control panel which is available on
 * `ctx.conversation`. It allows you to enter and exit conversations, and to
 * inspect which conversation is currently active.
 */
declare class ConversationControls {
    private readonly session;
    /** List of all conversations to be started */
    readonly [internal]: Internals;
    constructor(session: ConversationSessionData | undefined);
    /**
     * Returns a map of the identifiers of currently active conversations to the
     * number of times this conversation is active in the current chat. For
     * example, you can use `"captcha" in ctx.conversation.active` to check if
     * there are any active conversations in this chat with the identifier
     * `"captcha"`.
     */
    get active(): {
        [k: string]: number;
    };
    /**
     * Enters a conversation with the given identifier.
     *
     * Note that this method is async. You must `await` this method.
     */
    enter(id: string, _opts?: {
        /**
         * Specify `true` if all running conversations in the same chat should
         * be terminated before entering this conversation. Defaults to `false`.
         */
        overwrite?: boolean;
    }): Promise<void>;
    /**
     * Kills all conversations with the given identifier (if any) and enters a
     * new conversation for this identifier. Equivalent to passing `overwrite:
     * true` to `enter`.
     *
     * Note that this method is async. You must `await` this method.
     */
    reenter(id: string): void;
    /**
     * Hard-kills all conversations for a given identifier. Note that the normal
     * way for conversations to exit is for their conversation builder function
     * to complete (return or throw).
     *
     * If no identifier is specified, all running conversations of all
     * identifiers will be killed.
     */
    exit(id?: string): void;
}
/** Data which the conversations plugin adds to `ctx.session` */
interface ConversationSessionData {
    /** Internal data used by the conversations plugin. Do not modify. */
    conversation?: Record<string, ActiveConversation[]>;
}
interface ActiveConversation {
    /**
     * Log of operations that were performed so far in the conversation.
     * Used to replay past operations when resuming.
     */
    log: OpLog;
}
/**
 * Describes a log entry that does not only know its chronological position in
 * the log which indicates in what order the op was created, but also stores the
 * index at which the operation resolved. This makes it possible to accurately
 * track concurrent operations and deterministically replay the order in which
 * they resolved.
 */
interface AsyncOrder {
    /** Index used to determine the op resolve order */
    i: number;
}
/** Log of operations */
interface OpLog {
    /** Strictly ordered log of incoming updates */
    u: WaitOp[];
}
/** A `wait` call that was recorded onto the log */
interface WaitOp {
    /** Incoming update object used to recreate the context */
    u: Update;
    /**
     * All enumerable properties on the context object which should be persisted
     * in the session and restored when replaying. Excludes intrinsic
     * properties.
     */
    x: Record<string, unknown>;
    /** Method-keyed log of async-ordered API call results */
    a?: Record<string, ApiOp[]>;
    /** Log of async-ordered external operation results */
    e?: ExtOp[];
}
/** A Bot API call that was recorded onto the log */
interface ApiOp extends AsyncOrder {
    /** API call result, absent if the call did not complete in time */
    r?: ApiResponse<Awaited<ReturnType<RawApi[keyof RawApi]>>>;
}
/** An external operation that was recorded onto the log */
interface ExtOp extends AsyncOrder {
    /** Result of the task, absent if it did not complete in time */
    r?: {
        /** The operation succeeded and `v` was returned */
        v: any;
    } | {
        /** The operation failed and `e` was thrown */
        e: unknown;
    };
}
/** Ops that can lead to intertuption of function execution */
declare type ResolveOps = "wait" | "skip" | "done";
export declare function conversations<C extends Context>(): MiddlewareFn<C & ConversationFlavor>;
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
export declare function createConversation<C extends Context>(builder: ConversationBuilder<C>, id?: string): MiddlewareFn<C & ConversationFlavor>;
/**
 * > This should be the first parameter in your conversation builder function.
 *
 * This object gives you access to your conversation. You can think of it as a
 * handle which lets you perform basic operations in your conversation, such as
 * waiting for new messages.
 *
 * Typically, a conversation builder function has this signature:
 *
 * ```ts
 * async function greet(conversation: Conversation<MyContext>, ctx: MyContext) {
 *   // define your conversation here
 * }
 * ```
 *
 * Check out the [documentation](https://grammy.dev/plugins/conversations.html)
 * to learn more about how to create conversations.
 */
export declare type Conversation<C extends Context> = ConversationHandle<C>;
/**
 * Internally used class which acts as a conversation handle.
 */
export declare class ConversationHandle<C extends Context> {
    private readonly ctx;
    private readonly opLog;
    private readonly rsr;
    private replayIndex;
    private active;
    constructor(ctx: C, opLog: OpLog, rsr: Resolver<ResolveOps>);
    _deactivate(): void;
    /**
     * Internal flag, `true` if the conversation is currently replaying in order
     * to jump back to an old state, and `false` otherwise. Relying on this can
     * lead to very funky things, so only use this flag if you absolutely know
     * what you are doing. Most likely, you should not use this at all.
     */
    get _isReplaying(): boolean;
    /**
     * Internal method, retrieves the next logged wait operation from the stack
     * while replaying, and advances the replay cursor. Relying on this can lead
     * to very funky things, so only use this flag if you absolutely know what
     * you are doing. Most likely, you should not use this at all.
     */
    _replayWait(): C;
    _replayApi(method: string): Promise<NonNullable<ApiOp["r"]>>;
    _replayExt(): Promise<NonNullable<ExtOp["r"]>>;
    _logWait(op: WaitOp): void;
    _unlogWait(): WaitOp;
    _logApi(method: string): ApiOp;
    _logExt(): ExtOp;
    _finalize(slot: AsyncOrder): void;
    _resolveAt<T>(index: number, value?: T): Promise<T>;
    /**
     * Waits for a new update (e.g. a message, callback query, etc) from the
     * user. Once received, this method returns the new context object for the
     * incoming update.
     */
    wait(): Promise<C>;
    waitUntil<D extends C>(predicate: (ctx: C) => ctx is D): Promise<D>;
    waitUntil(predicate: (ctx: C) => boolean | Promise<boolean>): Promise<C>;
    waitUnless(predicate: (ctx: C) => boolean | Promise<boolean>): Promise<C>;
    waitFor<Q extends FilterQuery>(query: Q | Q[]): Promise<Filter<C, Q>>;
    waitFrom(user: number | User): Promise<C & {
        from: User;
    }>;
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
    skip(): Promise<never>;
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
    external<F extends (...args: any[]) => any, I = any>(op: F | {
        /** An operation to perform */
        task: F;
        /** Parameters to supply to the operation */
        args?: Parameters<F>;
        /** Prepare the result for storing */
        beforeStore?: (value: ReturnType<F>) => I | Promise<I>;
        /** Recover a result after storing */
        afterLoad?: (value: I) => ReturnType<F> | Promise<ReturnType<F>>;
        /** Prepare the result for storing */
        beforeStoreError?: (value: unknown) => unknown | Promise<unknown>;
        /** Recover a result after storing */
        afterLoadError?: (value: unknown) => unknown;
    }): Promise<Awaited<ReturnType<F>>>;
    /**
     * Sleep for the specified number of milliseconds. You should use this
     * instead of your own sleeping function so that you don't block the
     * conversation while it is restoring a previous position.
     *
     * @param milliseconds The number of milliseconds to wait
     */
    sleep(milliseconds: number): Promise<void>;
    /**
     * Safely generates a random number from `Math.random()`. You should use
     * this instead of `Math.random()` in your conversation because
     * non-deterministic behavior is not allowed.
     *
     * @returns A random number
     */
    random(): Promise<number>;
    /**
     * Safely perform `console.log` calls, but only when they should really be
     * logged (so not during replay operations).
     *
     * @param args Arguments to pass to `console.log`
     */
    log(...args: Parameters<typeof console.log>): void;
}
export {};
