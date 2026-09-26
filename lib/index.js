import { createRequire } from "node:module";
import ConfigSchema from "@deepseek-ai/schemastery";
import { z } from "zod";
import { execFile } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Context, Service } from "@deepseek-ai/cordis";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { tryLockExclusive } from "@deepseek-ai/node-addon-system/flock";
import { runNativeCommand } from "@deepseek-ai/dsh-native-command";
//#region lib/types/figure-thumbnail.js
/** Render the first page of a local PDF into a bounded gallery image. */
const runFile = promisify(execFile);
const PNG_HEADER = Buffer.from([
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10
]);
/**
* Render a PDF cover or readable page without exposing manuscript bytes to a converter's environment.
* @param path - already validated local PDF path.
* @param signal - authenticated request lifetime.
* @param size - short thumbnail or viewport-sized page.
* @returns a bounded PNG data URL, or undefined if no renderer can read this PDF.
*/
async function pdfThumbnail(path, signal, size = "thumb") {
	const directory = await mkdtemp(join(tmpdir(), "dsh-paper-figure-"));
	const output = join(directory, "page.png");
	const pixels = size === "thumb" ? "256" : "2200";
	const limit = size === "thumb" ? 2 * 1024 * 1024 : 16 * 1024 * 1024;
	const options = {
		signal,
		timeout: 15e3,
		maxBuffer: 64 * 1024,
		env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(key)))
	};
	try {
		const attempts = process.platform === "darwin" ? [["sips", [
			"-s",
			"format",
			"png",
			"-Z",
			pixels,
			path,
			"--out",
			output
		]], ["pdftoppm", [
			"-f",
			"1",
			"-l",
			"1",
			"-singlefile",
			"-scale-to",
			pixels,
			"-png",
			path,
			join(directory, "page")
		]]] : [["pdftoppm", [
			"-f",
			"1",
			"-l",
			"1",
			"-singlefile",
			"-scale-to",
			pixels,
			"-png",
			path,
			join(directory, "page")
		]]];
		for (const [command, args] of attempts) {
			signal.throwIfAborted();
			try {
				await runFile(command, args, options);
				const bytes = await readFile(output);
				if (bytes.length > 0 && bytes.length <= limit && bytes.subarray(0, 8).equals(PNG_HEADER)) return `data:image/png;base64,${bytes.toString("base64")}`;
			} catch (error) {
				if (signal.aborted) throw error;
			}
		}
		return;
	} finally {
		await rm(directory, {
			recursive: true,
			force: true
		});
	}
}
//#endregion
//#region ../../util/brand/lib/index.js
/**
* Duplicate-install-safe nominal primitive helpers.
*
* A brand makes structurally identical strings or numbers non-interchangeable
* at the type level: a `SessionId` cannot be passed where a `ToolCallId` is
* expected, and an event sequence cannot be passed as a log offset. Comparison,
* logging, and serialization retain the underlying primitive behavior.
*
* This package owns no concrete domain value and keeps no runtime identity or mutable
* state, so independently installed copies produce interchangeable values.
*
* @module @deepseek-ai/dsh-brand
*/
/**
* Apply a compile-time string brand without changing the value.
* @param value - string admitted by the domain that owns the target brand.
* @returns the same string with the requested compile-time brand.
*/
function brandString(value) {
	return value;
}
//#endregion
//#region ../../util/values/lib/index.js
/** Duplicate-install-safe JSON and immutable-value helpers. @module @deepseek-ai/dsh-util-values */
/**
* Mark an unreachable closed-union branch.
* @param value - impossible value; an unhandled typed variant fails at the call site.
* @param context - optional switch-site label included in the failure message.
* @returns never; a runtime value that escaped its type always throws.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor$1(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype$1(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor$1(value, "Object");
}
/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
function hasPlainArrayPrototype$1(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor$1(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype$1(objectPrototype);
}
/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
function hasPlainObjectPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype$1(prototype);
}
/** Return every JSON-visible object key, or reject own data JSON would discard. */
function enumerableStringKeys(value) {
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
	return keys;
}
/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */
function walkJsonValue(value, detach) {
	const ancestors = /* @__PURE__ */ new Set();
	let root;
	const assign = (destination, item) => {
		if (destination === void 0) return;
		if (destination.kind === "root") root = item;
		else if (destination.kind === "array") destination.target[destination.index] = item;
		else Object.defineProperty(destination.target, destination.key, {
			value: item,
			enumerable: true,
			configurable: true,
			writable: true
		});
	};
	const tasks = [{
		kind: "visit",
		value,
		...detach ? { destination: { kind: "root" } } : {}
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			ancestors.delete(task.source);
			continue;
		}
		if (task.kind === "array-item") {
			if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
			tasks.push({
				kind: "visit",
				value: task.source[task.index],
				...task.target === void 0 ? {} : { destination: {
					kind: "array",
					target: task.target,
					index: task.index
				} }
			});
			continue;
		}
		if (task.kind === "object-property") {
			tasks.push({
				kind: "visit",
				value: task.source[task.key],
				...task.target === void 0 ? {} : { destination: {
					kind: "object",
					target: task.target,
					key: task.key
				} }
			});
			continue;
		}
		const current = task.value;
		if (current === null) {
			assign(task.destination, null);
			continue;
		}
		if (typeof current === "boolean" || typeof current === "string") {
			assign(task.destination, current);
			continue;
		}
		if (typeof current === "number") {
			if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
			assign(task.destination, current);
			continue;
		}
		if (typeof current !== "object") return void 0;
		if (ancestors.has(current)) return void 0;
		if (Array.isArray(current)) {
			if (!hasPlainArrayPrototype$1(current)) return void 0;
			const length = current.length;
			if (Reflect.ownKeys(current).length !== length + 1) return void 0;
			const target = detach ? [] : void 0;
			if (target !== void 0) assign(task.destination, target);
			ancestors.add(current);
			tasks.push({
				kind: "leave",
				source: current
			});
			for (let index = length - 1; index >= 0; index--) tasks.push({
				kind: "array-item",
				source: current,
				index,
				...target === void 0 ? {} : { target }
			});
			continue;
		}
		if (!hasPlainObjectPrototype(current)) return void 0;
		const keys = enumerableStringKeys(current);
		if (keys === void 0) return void 0;
		const target = detach ? {} : void 0;
		if (target !== void 0) assign(task.destination, target);
		ancestors.add(current);
		tasks.push({
			kind: "leave",
			source: current
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) return void 0;
			tasks.push({
				kind: "object-property",
				source: current,
				key,
				...target === void 0 ? {} : { target }
			});
		}
	}
	return detach ? root : true;
}
/**
* Validate and detach lossless JSON in one read per property.
* @param value - candidate value to validate and detach.
* @returns the detached snapshot, or `undefined` when the value is not losslessly JSON-serializable.
*/
function snapshotJsonValue(value) {
	return walkJsonValue(value, true);
}
/**
* Test the same lossless JSON rules as {@link snapshotJsonValue} without detaching the value.
* @param value - candidate value to test.
* @returns whether the value survives a JSON round trip without loss.
*/
function isJsonValue(value) {
	return walkJsonValue(value, false) === true;
}
/**
* Deep-freeze an object graph in place while leaving live AbortSignal objects mutable.
* @param value - value to freeze.
* @returns the same value after every reachable enumerable child is frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region ../../core/scope/lib/index.js
/**
* Shared insertion-ordered storage and effect ownership for scope-aware registries.
*
* @module @deepseek-ai/dsh-scope
*/
/**
* Insertion-ordered named entries with caller-owned duplicate diagnostics.
*
* Values are borrowed. Iterators are live within one nonempty table
* generation; draining the table detaches them from later insertions. Each
* successful insertion returns an idempotent undo for that exact entry.
*/
var NamedEntries = class {
	duplicateError;
	data = /* @__PURE__ */ new Map();
	constructor(duplicateError) {
		this.duplicateError = duplicateError;
	}
	/**
	* Insert one unique name.
	* @param name - name unique within this table.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo that removes only this insertion.
	*/
	insert(name, value) {
		const data = this.data;
		if (data.has(name)) throw this.duplicateError(name);
		data.set(name, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(name);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Read one named value.
	* @param name - name to resolve.
	* @returns the retained value, or `undefined` when absent.
	*/
	get(name) {
		return this.data.get(name);
	}
	/**
	* Test one name for membership.
	* @param name - name to test.
	* @returns whether the table contains that name.
	*/
	has(name) {
		return this.data.has(name);
	}
	/**
	* Iterate live names in insertion order.
	* @returns the native live key iterator.
	*/
	keys() {
		return this.data.keys();
	}
	/**
	* Iterate live entries in insertion order.
	* @returns the native live entry iterator.
	*/
	entries() {
		return this.data.entries();
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Insertion-ordered anonymous entries with independent registration identity.
*
* Equal values remain separate registrations. Values are borrowed, and
* iterators are live within one nonempty table generation; draining the table
* detaches them from later appends.
*/
var AnonymousEntries = class {
	data = /* @__PURE__ */ new Map();
	/**
	* Append one independently owned value.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo for this exact append.
	*/
	append(value) {
		const data = this.data;
		const key = Symbol();
		data.set(key, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(key);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Own the global and exact-scope layers for one registry.
*
* Reads never create scoped layers. Registrations derive both visibility and
* effect ownership from the supplied Cordis context, collect undo before
* notification, and reclaim only a completely empty aggregate layer.
*/
var ScopedLayers = class {
	createLayer;
	onChange;
	/** The eagerly constructed context-global layer. */
	global;
	scoped = /* @__PURE__ */ new Map();
	constructor(createLayer, onChange) {
		this.createLayer = createLayer;
		this.onChange = onChange;
		this.global = createLayer(void 0);
	}
	/**
	* Read an existing exact-scope overlay. Deliberately chain-blind: callers
	* addressing one scope's OWN contributions (its restrictions, its guards)
	* must not silently pick up an ancestor's — use {@link chainLayers} where
	* inheritance is the point.
	* @param scope - exact scope key; `undefined` denotes no overlay.
	* @returns the existing scoped layer, or `undefined` without creating one.
	*/
	peek(scope) {
		if (scope === void 0) return void 0;
		return this.scoped.get(scope);
	}
	/**
	* Existing overlays along the scope's parent chain ({@link scopeChainOf}),
	* farthest ancestor first and the exact scope last, so a caller layering
	* them in order gives the nearest scope the final word.
	* @param scope - viewing scope, or `undefined` for no overlays.
	* @returns the existing layers, nearest last; absent overlays are skipped.
	*/
	chainLayers(scope) {
		const layers = [];
		for (const key of scopeChainOf(scope).reverse()) {
			const layer = this.scoped.get(key);
			if (layer !== void 0) layers.push(layer);
		}
		return layers;
	}
	/**
	* Materialize global named entries followed by scope-chain shadows,
	* farthest ancestor first, so the nearest scope's entry wins a name.
	* @param scope - viewing scope, or `undefined` for the global view.
	* @param pick - select the named table from a layer.
	* @returns an insertion-ordered effective map.
	*/
	merge(scope, pick) {
		const merged = new Map(pick(this.global).entries());
		for (const layer of this.chainLayers(scope)) for (const [name, value] of pick(layer).entries()) merged.set(name, value);
		return merged;
	}
	/**
	* Attach one synchronous layer mutation to its registration context.
	* @param ctx - context that determines both scope visibility and effect ownership.
	* @param action - atomic mutation returning its synchronous undo.
	* @param options - Cordis effect label and optional change notification.
	* @returns the exact disposer returned by `ctx.effect()`.
	*/
	effect(ctx, action, options) {
		const scope = scopeOf(ctx);
		const notify = options.notify ?? true;
		return ctx.effect(function* () {
			let layer;
			let created = false;
			if (scope === void 0) layer = this.global;
			else {
				const existing = this.scoped.get(scope);
				if (existing === void 0) {
					layer = this.createLayer(scope);
					this.scoped.set(scope, layer);
					created = true;
				} else layer = existing;
			}
			let undo;
			try {
				undo = action(layer);
			} catch (error) {
				if (scope !== void 0 && created && layer.isEmpty()) this.scoped.delete(scope);
				throw error;
			}
			yield () => {
				undo();
				if (scope !== void 0 && layer.isEmpty()) this.scoped.delete(scope);
				if (notify) this.onChange();
			};
			if (notify) this.onChange();
		}.bind(this), options.label);
	}
};
/**
* Scoped-context primitive: mint a Cordis context that tags registrations with
* an opaque identity and build routing-only event carriers for that identity.
*
* @module @deepseek-ai/dsh-scope
*/
/** Context tag written by {@link createScope}. */
const kScope = Symbol("dsh.scope");
/** The key associated with each carrier. Presence distinguishes an unkeyed carrier from a non-carrier. */
const carrierKeys = /* @__PURE__ */ new WeakMap();
/**
* The enclosing scope of each key. One relation powers both directions of
* scope nesting: registration views inherit DOWN the chain (a child scope
* sees its ancestors' layers — {@link ScopedLayers}), and event admission
* extends UP it (a listener tagged with an ancestor receives events dispatched
* to a descendant key — {@link scopeTarget}).
*/
const scopeParents = /* @__PURE__ */ new WeakMap();
/**
* The chain from a key to its root ancestor.
* @param key - the starting key, or `undefined` for the empty chain.
* @returns keys nearest-first: `[key, parent, grandparent, …]`.
*/
function scopeChainOf(key) {
	const chain = [];
	for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) chain.push(cursor);
	return chain;
}
/**
* Read the nearest scope tag inherited by a context.
* @param ctx - context to inspect.
* @returns its scope key, or `undefined` for an unscoped context.
*/
function scopeOf(ctx) {
	return ctx[kScope];
}
/**
* Build an opaque receiver that preserves the base filter, admits untagged
* listeners globally, and admits tagged listeners for a matching key or any
* of its ancestors ({@link bindScopeParent}): a listener owned by an enclosing
* scope receives every descendant scope's events, which is what lets one
* standing composition observe each of the agents composed under it. A tag
* BELOW the dispatch key stays excluded — events flow up the chain, never
* down.
* @param base - subject or service whose existing Cordis filter is preserved.
* @param key - routed scope identity, or `undefined` for an unscoped subject.
* @returns a carrier whose subject remains available only through event arguments.
*/
function scopeTarget(base, key) {
	const baseFilter = base[Context.filter];
	const carrier = { [Context.filter](ctx) {
		if (baseFilter !== void 0 && !baseFilter.call(base, ctx)) return false;
		const tag = scopeOf(ctx);
		if (tag === void 0) return true;
		for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) if (cursor === tag) return true;
		return false;
	} };
	carrierKeys.set(carrier, key);
	return carrier;
}
//#endregion
//#region ../../typert/protocol/lib/index.js
/** The one Remote failure class shared by owners, the Gateway, and consumers. */
/**
* One Remote call failure: a real Error carrying its stable code and typed
* details. Owners throw it at the failure point; the Host Gateway encodes it
* onto the wire unchanged; the Client face rebuilds an instance for the
* `RemoteResult` error branch, so `throw result.error` keeps throw semantics.
* Discrimination is always by `code`, never by instanceof.
*/
var RemoteError = class extends Error {
	code;
	details;
	/** Structural marker: cross-realm/bundle identification never uses instanceof. */
	isDSHRemoteError = true;
	/**
	* @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
	* @param message - human diagnostic carried across the wire.
	* @param details - structured payload typed by the code.
	* @param options - standard Error options (`cause` survives in-process only).
	*/
	constructor(code, message, details, options) {
		super(message, options);
		this.code = code;
		this.details = details;
		this.name = "RemoteError";
	}
};
/**
* Remote decorators and explicit Gateway bindings backed by versioned
* descriptors carried on decorated class prototypes. Strict reflection
* remains a Typert compiler responsibility.
* @module @deepseek-ai/dsh-typert-protocol
*/
const TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/**
* Test one generated Remote name against the Connection endpoint grammar.
* @param value - namespace, method, lookup, or Context segment.
* @returns whether the value can cross the shared RPC carrier unchanged.
*/
function isTypertRemoteSegment(value) {
	return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
/**
* Bind one visible Service field to a Cordis key and Remote namespace. A
* service that owns a Cordis Context also gives its tree `ctx.invocation`,
* `undefined` outside a Remote call, so no `TypertRemoteService` is needed for
* a Host composition to read it.
* @param service - owning Service instance, normally `this`.
* @param serviceKey - exact Cordis service key.
* @param options - optional distinct wire namespace.
* @returns a frozen, inspectable binding with no compiler-injected metadata.
*/
function bindTypertRemote(service, serviceKey, options = {}) {
	validateName("service key", serviceKey);
	const namespace = options.namespace ?? serviceKey;
	validateName("namespace", namespace);
	const ctx = Reflect.get(service, "ctx");
	if (ctx instanceof Context) provideInvocationAccessor(ctx);
	return Object.freeze({
		service,
		serviceKey,
		namespace
	});
}
/** Cordis Service base that exposes its registered name through Typert Gateway. */
var TypertRemoteService = class extends Service {
	/** Visible binding consumed by the Gateway's source-mode discovery. */
	typertRemote;
	/**
	* Register the Service and bind the same key to Typert Gateway.
	* @param ctx - owning Cordis Context.
	* @param serviceKey - exact Cordis service key and default wire namespace.
	* @param options - optional distinct wire namespace.
	*/
	constructor(ctx, serviceKey, options = {}) {
		super(ctx, serviceKey);
		this.typertRemote = bindTypertRemote(this, this.name, options);
	}
};
/**
* Make `ctx.invocation` read as `undefined` outside a Remote call instead of the
* reflect service's "cannot get property" error; a call-derived Context shadows
* the accessor with its own property. The first Remote Service constructed in a
* tree registers it on the root, where it outlives any one Service.
*/
function provideInvocationAccessor(ctx) {
	if (Object.hasOwn(ctx.root.reflect.props, "invocation")) return;
	ctx.root.accessor("invocation", { get: () => void 0 });
}
function Remote(methodExportOrOptions, context) {
	if (typeof methodExportOrOptions === "string") {
		validateName("Remote export name", methodExportOrOptions);
		return remoteDecorator({ kind: "direct" }, void 0, methodExportOrOptions);
	}
	if (typeof methodExportOrOptions === "object") {
		if (remoteOptionMode(methodExportOrOptions) !== "stream" || Reflect.ownKeys(methodExportOrOptions).length !== 1) throw new TypeError("typert-protocol: Remote options must contain exactly mode: \"stream\"");
		return remoteDecorator({ kind: "direct" }, "stream");
	}
	if (context === void 0) throw new TypeError("typert-protocol: Remote decorator context is missing");
	addMarkerInitializer(context, { kind: "direct" });
}
function remoteOptionMode(options) {
	return Reflect.get(options, "mode");
}
function remoteDecorator(invocation, mode, exportName) {
	return function(_method, context) {
		addMarkerInitializer(context, invocation, mode, exportName);
	};
}
function readRemoteMethodDescriptor(prototype) {
	const property = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR);
	if (property === void 0) return void 0;
	const descriptor = property.value;
	if (descriptor === null || typeof descriptor !== "object") throw new TypeError("typert-protocol: Remote method descriptor must be an object");
	const version = Reflect.get(descriptor, "version");
	if (version !== 1) throw new TypeError(`typert-protocol: unsupported Remote method descriptor version ${String(version)}`);
	const methods = Reflect.get(descriptor, "methods");
	if (!Array.isArray(methods)) throw new TypeError("typert-protocol: Remote method descriptor methods must be an array");
	return descriptor;
}
function addMarkerInitializer(context, invocation, mode, exportName) {
	if (context.private || context.static || typeof context.name !== "string") throw new TypeError("typert-protocol: Remote decorators require a public instance method with a string name");
	const method = context.name;
	context.addInitializer(function() {
		const prototype = Object.getPrototypeOf(this);
		if (prototype === null) throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`);
		mark(prototype, method, invocation, mode, exportName);
	});
}
function mark(prototype, method, invocation, mode, exportName) {
	const descriptor = readRemoteMethodDescriptor(prototype);
	const marker = Object.freeze({
		method,
		...exportName === void 0 || exportName === method ? {} : { exportName },
		...mode === void 0 ? {} : { mode },
		invocation: Object.freeze(invocation)
	});
	const current = descriptor?.methods.find((candidate) => candidate.method === method);
	if (current !== void 0) {
		if (current.exportName === marker.exportName && current.mode === marker.mode && sameInvocation(current.invocation, invocation)) return;
		throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
	}
	Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
		configurable: true,
		value: Object.freeze({
			version: 1,
			methods: Object.freeze([...descriptor?.methods ?? [], marker])
		})
	});
}
function sameInvocation(left, right) {
	if (left.kind === "direct") return right.kind === "direct";
	if (right.kind === "direct") return false;
	return left.context === right.context;
}
function validateName(subject, value) {
	if (!isTypertRemoteSegment(value)) throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
}
//#endregion
//#region ../../util/crypto/lib/index.js
/**
* Random v4 UUID, minted from `crypto.getRandomValues`.
* @returns the UUID string.
*/
function randomUUID$1() {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	const hex = Array.from(bytes, (byte, index) => {
		return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
	}).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
//#endregion
//#region ../../util/timeout/lib/index.js
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region ../../llm/llm/lib/index.js
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return deepFreeze(structuredClone({
		...input,
		id: brandString(randomUUID$1())
	}));
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
/**
* Harness error base with a stable machine-routable code and chained cause.
* Package errors extend it so tool results and replay can retain failure class.
* @module @deepseek-ai/dsh-llm/error
*/
/**
* Base class for all harness errors. Carries a `code` (stable, programmatic —
* e.g. `NO_ADAPTER`, `INVALID_ARGS`, `INVARIANT`) distinct from the
* human-readable `message`, and supports `cause` chaining via the standard
* `ErrorOptions`. `name` defaults to the subclass constructor name.
*/
var HarnessError = class extends Error {
	/** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
	code;
	constructor(message, code, options) {
		super(message, options);
		this.code = code;
		this.name = new.target.name;
	}
};
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = ConfigSchema.object({
	initialDelayMs: ConfigSchema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: ConfigSchema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: ConfigSchema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = ConfigSchema.object({
	mode: ConfigSchema.const("normal").required(),
	maxRetries: ConfigSchema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: ConfigSchema.array(ConfigSchema.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = ConfigSchema.object({
	mode: ConfigSchema.const("always").required(),
	backoff: backoffSchema
});
ConfigSchema.union([normalPolicySchema, alwaysPolicySchema]);
const NORMAL_POLICY_KEYS = new Set([
	"mode",
	"maxRetries",
	"retryableCodes",
	"backoff"
]);
const ALWAYS_POLICY_KEYS = new Set([
	"mode",
	"maxRetries",
	"retryableCodes",
	"backoff"
]);
const BACKOFF_KEYS = new Set([
	"initialDelayMs",
	"maxDelayMs",
	"jitterRatio"
]);
function validateKeys(value, allowed, path) {
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`);
}
function resolveBackoff(config, path) {
	if (config !== void 0) validateKeys(config, BACKOFF_KEYS, path);
	const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
	const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO;
	if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > 2147483647) throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > 2147483647) throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
	if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error(`${path}.jitterRatio must be between 0 and 1`);
	return Object.freeze({
		initialDelayMs,
		maxDelayMs,
		jitterRatio
	});
}
/**
* Validate, default, and detach one provider-owned retry policy.
* @param config - optional provider configuration; omission selects normal defaults.
* @param path - diagnostic path naming the provider config that owns the value.
* @returns an immutable policy safe to capture in provider registration state.
*/
function resolveRetryPolicy(config, path) {
	if (config === void 0) return Object.freeze({
		mode: "normal",
		maxRetries: DEFAULT_MAX_RETRIES,
		retryableCodes: DEFAULT_RETRYABLE_CODES,
		...resolveBackoff(void 0, `${path}.backoff`)
	});
	switch (config.mode) {
		case "normal": {
			validateKeys(config, NORMAL_POLICY_KEYS, path);
			const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
			const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES];
			if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error(`${path}.maxRetries must be a non-negative safe integer`);
			if (retryableCodes.length === 0) throw new Error(`${path}.retryableCodes must not be empty`);
			if (retryableCodes.some((code) => typeof code !== "string" || code.length === 0)) throw new Error(`${path}.retryableCodes must contain only non-empty strings`);
			if (new Set(retryableCodes).size !== retryableCodes.length) throw new Error(`${path}.retryableCodes must not contain duplicates`);
			return Object.freeze({
				mode: "normal",
				maxRetries,
				retryableCodes: Object.freeze([...retryableCodes]),
				...resolveBackoff(config.backoff, `${path}.backoff`)
			});
		}
		case "always":
			validateKeys(config, ALWAYS_POLICY_KEYS, path);
			return Object.freeze({
				mode: "always",
				...resolveBackoff(config.backoff, `${path}.backoff`)
			});
		default: throw new Error(`${path}.mode must be "normal" or "always"`);
	}
}
/**
* Field-wise equality over {@link LlmCallConfig} — the comparison a caller
* runs to decide whether a proposed configuration is a real change (worth a
* logged header snapshot) or the held one restated.
* @param a - one configuration.
* @param b - the other.
* @returns whether every field (including the `stop` list, element-wise) matches.
*/
function callConfigEquals(a, b) {
	if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
	if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
	return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
/**
* Normalization for values thrown by a final LLM adapter boundary.
*
* @module @deepseek-ai/dsh-llm/adapter-failure
*/
/**
* Detach serializable provider facts from a value thrown by an adapter.
* @param value - arbitrary value thrown during adapter dispatch or iteration.
* @returns immutable provider-neutral facts suitable for a terminal finish chunk.
* @internal
*/
function normalizeLlmFailure(value) {
	const error = value instanceof Error ? value : new HarnessError(thrownMessage(value), "UNKNOWN", { cause: value });
	const carried = ownFailureSnapshot(error);
	if (carried !== void 0 && carried.code === ownErrorCode(error)) return carried;
	return Object.freeze({
		message: errorMessage$1(error),
		code: harnessErrorCode(error)
	});
}
/** Render a non-Error throw without letting hostile coercion escape normalization. */
function thrownMessage(value) {
	try {
		const message = String(value);
		return message.length > 0 ? message : "LLM adapter failed";
	} catch (_hostileThrownValue) {
		return "LLM adapter failed";
	}
}
/** Read a foreign error's own data-backed `code` without invoking accessors. */
function ownErrorCode(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "code");
		return descriptor !== void 0 && "value" in descriptor ? descriptor.value : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Snapshot an own data property without invoking an SDK-defined accessor. */
function ownFailureSnapshot(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
		return descriptor !== void 0 && "value" in descriptor ? failureSnapshot(descriptor.value) : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Validate and detach an arbitrary serializable failure payload. */
function failureSnapshot(value) {
	if (typeof value !== "object" || value === null) return void 0;
	try {
		const candidate = value;
		const message = candidate.message;
		const code = candidate.code;
		const status = candidate.status;
		const providerRetryAfterMs = candidate.providerRetryAfterMs;
		const requestId = candidate.requestId;
		const offloadImages = candidate.offloadImages;
		if (typeof message !== "string" || message.length === 0 || typeof code !== "string" || code.length === 0 || status !== void 0 && (!Number.isInteger(status) || status < 100 || status > 599) || providerRetryAfterMs !== void 0 && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0) || requestId !== void 0 && (typeof requestId !== "string" || requestId.length === 0) || offloadImages !== void 0 && (!Number.isSafeInteger(offloadImages) || offloadImages <= 0)) return void 0;
		return Object.freeze({
			message,
			code,
			...status === void 0 ? {} : { status },
			...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
			...requestId === void 0 ? {} : { requestId },
			...offloadImages === void 0 ? {} : { offloadImages }
		});
	} catch (_sdkFailureGetter) {
		return;
	}
}
/** Read an SDK error message without letting an accessor replace the primary failure. */
function errorMessage$1(error) {
	try {
		const message = error.message;
		if (typeof message === "string" && message.length > 0) return message;
	} catch (_sdkMessageGetter) {}
	return "LLM adapter failed";
}
/** Trust only Harness-owned codes; third-party SDK codes are not our taxonomy. */
function harnessErrorCode(error) {
	return error instanceof HarnessError ? error.code : "UNKNOWN";
}
function quoted(value) {
	return JSON.stringify(value);
}
/**
* Stable text shown to a model that cannot accept one durable image reference.
* @param ref - durable normalized attachment omitted from the request.
* @returns deterministic text-only placeholder.
*/
function textOnlyImageText(ref) {
	return `[image omitted because this model accepts text only; attachment sha256:${String(ref.attachmentId).slice(7, 15)}]`;
}
/**
* True when typed model content contains an image block. This is the one image
* walk shared by every image policy (capability gating, text-only
* serialization, compaction survey), so a consumer cannot silently diverge.
* @param content - typed model content blocks.
* @returns whether any block is an image.
*/
function contentHasImage(content) {
	return content.some((block) => block.type === "image");
}
/**
* True when typed model content contains a file block.
* Reads current content on every call without retaining scan results.
* @param content - typed model content blocks.
* @returns whether any block is a file.
*/
function contentHasFile(content) {
	for (const block of content) if (block.type === "file") return true;
	return false;
}
/**
* Stable model-facing handle for one durable file reference: the address of
* the verbatim stored copy and the instruction to read it on demand. This is
* the only representation a provider ever receives for a file.
* @param ref - durable verbatim file reference.
* @param readonlyPath - execution-world path of the stored copy, when resolvable.
* @returns deterministic handle text naming the file, its size, and its address.
*/
function fileHandleText(ref, readonlyPath) {
	const digest = String(ref.attachmentId).slice(7, 15);
	const identity = `File ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest})`;
	if (readonlyPath === void 0) return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`;
	return `[${identity}: verbatim read-only copy saved at ${quoted(readonlyPath)}. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it. When delegating file work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it.]`;
}
/** Replace every file occurrence with handle text. */
function replaceFilesWithHandles(blocks, resolvePath) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "file") {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: fileHandleText(block.attachment, resolvePath(block.attachment))
			});
			continue;
		}
		next?.push(block);
	}
	return next ?? blocks;
}
function projectFilesToText(messages, resolvePath) {
	if (!messages.some((message) => contentHasFile(message.content))) return messages;
	return messages.map((message) => {
		const content = replaceFilesWithHandles(message.content, resolvePath);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
/** Replace every image occurrence for a text-only model. */
function replaceImagesForTextModel(blocks) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "image") {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: textOnlyImageText(block.attachment)
			});
			continue;
		}
		next?.push(block);
	}
	return next ?? blocks;
}
function projectImagesForTextModel(messages) {
	if (!messages.some((message) => contentHasImage(message.content))) return messages;
	return messages.map((message) => {
		const content = replaceImagesForTextModel(message.content);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
/**
* LLM service: adapter registry with a waterfall-interceptable streaming call
* API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
* provider backends, and `BlockAssembler` for chunk assembly.
*
* @module @deepseek-ai/dsh-llm
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/**
* Typed error for LLM-related failures. Extends {@link HarnessError}, so the
* `code` string (e.g. `AUTH`, `RATE_LIMIT`, `NO_ADAPTER`) is shared taxonomy.
*/
var LlmError = class extends HarnessError {
	/** Serializable facts retained beside this live Error. */
	failure;
	/**
	* @param message - non-empty human-readable failure summary.
	* @param code - non-empty stable provider-neutral machine code.
	* @param options - optional cause and validated serializable provider facts.
	*/
	constructor(message, code, options) {
		if (typeof message !== "string" || message.length === 0) throw new Error("LlmError message must be a non-empty string");
		if (typeof code !== "string" || code.length === 0) throw new Error("LlmError code must be a non-empty string");
		if (options?.status !== void 0 && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) throw new Error("LlmError status must be an integer from 100 through 599");
		if (options?.providerRetryAfterMs !== void 0 && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) throw new Error("LlmError providerRetryAfterMs must be a positive finite number");
		if (options?.requestId !== void 0 && (typeof options.requestId !== "string" || options.requestId.length === 0)) throw new Error("LlmError requestId must be a non-empty string");
		super(message, code, options);
		this.name = "LlmError";
		this.failure = Object.freeze({
			message,
			code,
			...options?.status === void 0 ? {} : { status: options.status },
			...options?.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
			...options?.requestId === void 0 ? {} : { requestId: options.requestId },
			...options?.offloadImages === void 0 ? {} : { offloadImages: options.offloadImages }
		});
	}
};
(() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _listProviders_decorators;
	let _listConfigurableProviders_decorators;
	let _remoteDiscoverModels_decorators;
	return class LlmRuntime extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_listProviders_decorators = [Remote];
			_listConfigurableProviders_decorators = [Remote];
			_remoteDiscoverModels_decorators = [Remote("discoverModels")];
			__esDecorate(this, null, _listProviders_decorators, {
				kind: "method",
				name: "listProviders",
				static: false,
				private: false,
				access: {
					has: (obj) => "listProviders" in obj,
					get: (obj) => obj.listProviders
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _listConfigurableProviders_decorators, {
				kind: "method",
				name: "listConfigurableProviders",
				static: false,
				private: false,
				access: {
					has: (obj) => "listConfigurableProviders" in obj,
					get: (obj) => obj.listConfigurableProviders
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteDiscoverModels_decorators, {
				kind: "method",
				name: "remoteDiscoverModels",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteDiscoverModels" in obj,
					get: (obj) => obj.remoteDiscoverModels
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		adapters = (__runInitializers(this, _instanceExtraInitializers), /* @__PURE__ */ new Map());
		directory = /* @__PURE__ */ new Map();
		discoveries = /* @__PURE__ */ new Map();
		constructor(ctx) {
			super(ctx, "llm");
		}
		/** Notify topology observers without letting one broken listener veto the commit. */
		emitAdaptersUpdated() {
			let invariantFailure;
			for (const listener of this.ctx.events.dispatch("emit", ["llm/adapters-updated"])) try {
				const returned = listener();
				if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
					this.warnAdaptersListenerFailure(error);
				});
			} catch (error) {
				if (error?.code === "INVARIANT") {
					invariantFailure ??= error;
					continue;
				}
				this.warnAdaptersListenerFailure(error);
			}
			if (invariantFailure !== void 0) throw invariantFailure;
		}
		/** Contained-listener diagnostic shared by the sync and async failure paths. */
		warnAdaptersListenerFailure(error) {
			this.ctx.logger.warn("llm: an llm/adapters-updated listener failed");
			this.ctx.logger.warn(error);
		}
		/**
		* Register an adapter for the given provider routes. Throws `LlmError` with code
		* `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
		* Disposed with the fiber.
		* @param providers - every provider route this adapter should serve.
		* @param adapter - the adapter that streams calls for those providers.
		* @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
		*/
		registerAdapter(providers, adapter) {
			const owned = /* @__PURE__ */ new Set();
			let released = false;
			const dispose = this.ctx.effect(function* () {
				if (providers.length === 0) throw new LlmError("an adapter must register at least one provider", "INVALID_ADAPTER");
				this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned));
				yield () => {
					released = true;
					for (const provider of owned) this.adapters.delete(provider);
					owned.clear();
					this.emitAdaptersUpdated();
				};
			}.bind(this), "llm.registerAdapter()");
			const handle = (() => void dispose());
			handle.replace = (next) => {
				if (released) throw new LlmError("a disposed adapter registration cannot replace its routes", "REGISTRATION_DISPOSED");
				this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned));
			};
			return handle;
		}
		/**
		* Validate one candidate route set for `adapter`, treating routes this
		* registration already holds as available. Nothing is mutated: a rejected
		* candidate leaves the registry exactly as it was.
		*/
		prepareRoutes(providers, adapter, owned) {
			const unique = /* @__PURE__ */ new Set();
			const registrations = [];
			for (const provider of providers) {
				if (provider.length === 0) throw new LlmError("adapter provider names must be non-empty", "INVALID_ADAPTER");
				if (unique.has(provider) || this.adapters.has(provider) && !owned.has(provider)) throw new LlmError(`an adapter for provider "${provider}" is already registered`, "DUPLICATE_ADAPTER");
				const info = adapter.providerInfo(provider);
				if (typeof info.id !== "string" || info.id !== provider || typeof info.name !== "string" || info.name.length === 0) throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, "INVALID_ADAPTER");
				unique.add(provider);
				const retryPolicy = adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(void 0, `llm: provider "${provider}" retryPolicy`);
				registrations.push({
					adapter,
					provider: {
						id: info.id,
						name: info.name
					},
					retryPolicy
				});
			}
			return registrations;
		}
		/**
		* Swap this registration's routes for the prepared ones in one synchronous
		* section, so no observer can see the registry between the release and the
		* re-registration. The route set's one mutation point is also where
		* `llm/adapters-updated` is published, so a `replace` announces itself
		* exactly like a first registration.
		*/
		commitRoutes(owned, registrations) {
			for (const provider of owned) this.adapters.delete(provider);
			owned.clear();
			for (const registration of registrations) {
				this.adapters.set(registration.provider.id, registration);
				owned.add(registration.provider.id);
			}
			this.emitAdaptersUpdated();
		}
		/**
		* Describe provider routes with a registered adapter.
		* @returns detached provider metadata in registration order.
		*/
		listProviders() {
			return [...this.adapters.values()].map(({ provider }) => ({ ...provider }));
		}
		/**
		* Declare provider routes an adapter plugin can activate through
		* configuration. Registration is all-or-nothing: an empty list, invalid
		* entry, or a provider already declared by any registration throws
		* `LlmError` without registering the rest. Disposed with the fiber.
		* @param entries - every configurable provider this plugin owns.
		* @returns a handle that withdraws all of them, and can atomically replace them.
		*/
		registerConfigurableProviders(entries) {
			let held = [];
			let disposed = false;
			/**
			* Validate a candidate set in full against everything this registration
			* does not already hold, then publish it. Nothing is written until the
			* whole set passes, so a refused candidate leaves the current entries in
			* place — the property that makes `replace` a swap rather than a
			* delete-then-add that can strand the directory empty.
			*/
			const commit = (candidates) => {
				const detached = [];
				const own = new Set(held.map((entry) => entry.provider));
				for (const entry of candidates) {
					if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) throw new LlmError("configurable providers need a non-empty provider, displayName, and settingsNs", "INVALID_DIRECTORY");
					if (entry.settingsPath.some((segment) => segment.length === 0)) throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, "INVALID_DIRECTORY");
					if (this.directory.has(entry.provider) && !own.has(entry.provider) || detached.some((seen) => seen.provider === entry.provider)) throw new LlmError(`configurable provider "${entry.provider}" is already declared`, "DUPLICATE_DIRECTORY");
					detached.push({
						...entry,
						settingsPath: [...entry.settingsPath]
					});
				}
				for (const entry of held) this.directory.delete(entry.provider);
				for (const entry of detached) this.directory.set(entry.provider, entry);
				held = detached;
				this.emitAdaptersUpdated();
			};
			const dispose = this.ctx.effect(function* () {
				if (entries.length === 0) throw new LlmError("a configurable-provider registration must declare at least one provider", "INVALID_DIRECTORY");
				commit(entries);
				yield () => {
					disposed = true;
					for (const entry of held) this.directory.delete(entry.provider);
					held = [];
					this.emitAdaptersUpdated();
				};
			}.bind(this), "llm.registerConfigurableProviders()");
			const handle = (() => void dispose());
			handle.replace = (next) => {
				if (disposed) throw new LlmError("this configurable-provider registration was disposed", "REGISTRATION_DISPOSED");
				commit(next);
			};
			return handle;
		}
		/**
		* List every declared configurable provider, registered or dormant.
		* @returns detached directory entries in declaration order.
		*/
		listConfigurableProviders() {
			return [...this.directory.values()].map((entry) => ({
				...entry,
				settingsPath: [...entry.settingsPath]
			}));
		}
		/**
		* Offer to interrogate provider endpoints on behalf of the settings
		* namespace this plugin owns. The namespace is the key because that is what
		* a configuration surface already holds from the configurable-provider
		* directory, and because a provider being *added* has no route to name yet.
		* Disposed with the fiber.
		* @param settingsNs - the namespace whose profiles this discovery serves.
		* @param discover - interrogates one endpoint and must honor the supplied signal.
		* @returns the disposer that withdraws the offer.
		*/
		registerModelDiscovery(settingsNs, discover) {
			const dispose = this.ctx.effect(function* () {
				if (settingsNs.length === 0) throw new LlmError("model discovery needs a non-empty settings namespace", "INVALID_DISCOVERY");
				if (this.discoveries.has(settingsNs)) throw new LlmError(`model discovery for "${settingsNs}" is already registered`, "DUPLICATE_DISCOVERY");
				this.discoveries.set(settingsNs, discover);
				yield () => {
					this.discoveries.delete(settingsNs);
				};
			}.bind(this), "llm.registerModelDiscovery()");
			return () => void dispose();
		}
		/**
		* Interrogate one provider endpoint for the models it advertises. The
		* request describes a draft, not a stored route, so nothing here reads or
		* writes settings or credentials — the caller owns both, and the reply is
		* candidate metadata a surface may offer for adoption.
		* @param settingsNs - namespace whose registered discovery serves this draft.
		* @param request - the endpoint, protocol, and one-shot credential to use.
		* @param signal - caller cancellation.
		* @returns the advertised models, deduplicated in endpoint order.
		*/
		async discoverModels(settingsNs, request, signal) {
			const discover = this.discoveries.get(settingsNs);
			if (discover === void 0) throw new LlmError(`no model discovery is registered for "${settingsNs}"`, "NO_DISCOVERY");
			if ((request.provider ?? "").length === 0 && (request.baseURL ?? "").length === 0) throw new LlmError("model discovery needs a provider route or a baseURL", "INVALID_DISCOVERY");
			const discovered = signal === void 0 ? await discover(request) : await discover(request, signal);
			const seen = /* @__PURE__ */ new Set();
			const models = [];
			for (const model of discovered) {
				if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
				seen.add(model.id);
				models.push({
					id: model.id,
					...model.name === void 0 ? {} : { name: model.name },
					...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
					...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
					...model.inputModalities === void 0 ? {} : { inputModalities: [...model.inputModalities] }
				});
			}
			return models;
		}
		/**
		* Remote adapter for one draft provider interrogation.
		* @param settingsNs - namespace whose registered discovery serves this draft.
		* @param request - endpoint, protocol, and one-shot credential to use.
		* @param signal - caller cancellation supplied by the Remote carrier.
		* @returns advertised models in endpoint order.
		* @throws RemoteError with `llm/model-discovery-rejected` when discovery refuses or fails.
		*/
		async remoteDiscoverModels(settingsNs, request, signal) {
			try {
				return await this.discoverModels(settingsNs, request, signal);
			} catch (error) {
				throw new RemoteError("llm/model-discovery-rejected", error instanceof Error ? error.message : String(error), {
					settingsNs,
					...request.baseURL === void 0 ? {} : { baseURL: request.baseURL }
				}, { cause: error });
			}
		}
		/**
		* Resolve the retry policy captured when one provider route was registered.
		* @param provider - registered provider route to inspect.
		* @returns the provider-owned policy, with normal defaults already resolved.
		*/
		providerRetryPolicy(provider) {
			return this.registration(provider).retryPolicy;
		}
		/**
		* Resolve provider-side request-image pricing for one exact route, or
		* `undefined` when the provider is unregistered or declares none. Unknown
		* providers degrade to `undefined` rather than throwing because callers
		* price durable history whose route may no longer be mounted.
		* @param provider - provider route named by a request header.
		* @param model - exact model id named by the same header.
		* @returns the owning adapter's image pricing for the route, when declared.
		*/
		imageRequestPricing(provider, model) {
			return this.adapters.get(provider)?.adapter.imageRequestPricing(provider, model);
		}
		/**
		* Resolve the exact text one durable file occurrence contributes to every
		* provider request in the current execution environment.
		* @param ref - durable verbatim file reference from model history.
		* @returns the same deterministic handle text used at adapter dispatch.
		*/
		fileRequestText(ref) {
			return fileHandleText(ref, this.fileReadPath(ref));
		}
		/** Detach typed adapter-owned modality metadata. */
		detachedModalities(modalities) {
			return modalities === void 0 ? void 0 : [...modalities];
		}
		/**
		* Discover models advertised by one registered provider. Catalog membership
		* is advisory and never changes routing or request validation.
		* @param provider - registered provider route to inspect.
		* @returns detached model metadata in adapter-preferred order.
		*/
		async listModels(provider) {
			const models = await this.registration(provider).adapter.listModels(provider);
			const seen = /* @__PURE__ */ new Set();
			return models.map((model) => {
				if (typeof model.provider !== "string" || model.provider !== provider || typeof model.id !== "string" || model.id.length === 0 || typeof model.name !== "string" || model.name.length === 0 || model.description !== void 0 && typeof model.description !== "string" || seen.has(model.id)) throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, "INVALID_CATALOG");
				seen.add(model.id);
				const inputModalities = this.detachedModalities(model.inputModalities);
				return {
					provider: model.provider,
					id: model.id,
					name: model.name,
					...model.description === void 0 ? {} : { description: model.description },
					...inputModalities === void 0 ? {} : { inputModalities }
				};
			});
		}
		/**
		* Resolve and validate all metadata from the adapter that owns one exact
		* route. The result is detached from adapter-owned objects; catalog
		* membership remains advisory and does not control request routing.
		* @param provider - registered provider route to inspect.
		* @param model - exact model id passed to the adapter.
		* @param signal - optional cancellation for adapter-owned asynchronous lookup.
		* @returns exact model identity plus available context and reasoning metadata.
		*/
		async resolveModelInfo(provider, model, signal) {
			return this.resolveModelInfoFor(this.registration(provider), model, signal);
		}
		async resolveModelInfoFor(registration, model, signal) {
			const resolved = await registration.adapter.resolveModel(registration.provider.id, model, signal);
			return this.normalizeModelInfo(registration, model, resolved);
		}
		/** Validate and detach one adapter-returned exact model result. */
		normalizeModelInfo(registration, model, resolved) {
			const provider = registration.provider.id;
			if (typeof resolved.provider !== "string" || resolved.provider !== provider || typeof resolved.id !== "string" || resolved.id !== model || typeof resolved.name !== "string" || resolved.name.length === 0 || resolved.description !== void 0 && typeof resolved.description !== "string") throw new LlmError(`adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
			const context = resolved.context;
			if (context !== void 0 && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) throw new LlmError(`adapter returned invalid context metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_CONTEXT");
			const inputModalities = this.detachedModalities(resolved.inputModalities);
			const systemPromptUpdate = resolved.systemPromptUpdate;
			if (systemPromptUpdate !== void 0 && systemPromptUpdate !== "in-history") throw new LlmError(`adapter returned invalid system prompt update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
			const defaultMaxTokens = resolved.defaultMaxTokens;
			if (defaultMaxTokens !== void 0 && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) throw new LlmError(`adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`, "INVALID_MODEL_MAX_TOKENS");
			const info = {
				provider,
				id: model,
				name: resolved.name,
				...resolved.description === void 0 ? {} : { description: resolved.description },
				...inputModalities === void 0 ? {} : { inputModalities },
				...context === void 0 ? {} : { context: { contextWindow: context.contextWindow } },
				...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
				...resolved.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: resolved.systemPromptUpdate }
			};
			const reasoning = resolved.reasoning;
			if (reasoning === void 0) return info;
			if (reasoning.efforts.length === 0) throw new LlmError(`adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
			const seen = /* @__PURE__ */ new Set();
			const efforts = reasoning.efforts.map((effort) => {
				if (typeof effort.id !== "string" || effort.id.length === 0 || typeof effort.name !== "string" || effort.name.length === 0 || effort.description !== void 0 && typeof effort.description !== "string" || seen.has(effort.id)) throw new LlmError(`adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
				seen.add(effort.id);
				return {
					id: effort.id,
					name: effort.name,
					...effort.description === void 0 ? {} : { description: effort.description }
				};
			});
			if (reasoning.defaultEffort !== void 0 && !seen.has(reasoning.defaultEffort)) throw new LlmError(`adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
			return {
				...info,
				reasoning: {
					efforts,
					...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
				}
			};
		}
		/**
		* Validate a conversation call config against its exact model capability and
		* materialize adapter-configured defaults. Unsupported explicit efforts
		* reject before provider I/O; no clamping or aliasing is performed. This
		* standalone query does not bind a later dispatch; use {@link prepareCall}
		* when logging and streaming must share one adapter registration.
		* @param config - provider/model route and optional request controls.
		* @param signal - optional cancellation for adapter-owned capability lookup.
		* @returns a detached config only when a default must be materialized.
		*/
		async resolveCallConfig(config, signal) {
			return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
		}
		async resolveCallFor(registration, config, signal) {
			const info = await this.resolveModelInfoFor(registration, config.model, signal);
			return this.resolveCallWithInfo(config, info);
		}
		/** Validate request controls against one already-bound exact model result. */
		resolveCallWithInfo(config, info) {
			const defaulted = config.maxTokens === void 0 && info.defaultMaxTokens !== void 0 ? {
				...config,
				maxTokens: info.defaultMaxTokens
			} : config;
			const reasoning = info.reasoning;
			const requested = defaulted.reasoningEffort;
			let resolvedConfig = defaulted;
			if (reasoning === void 0) {
				if (requested !== void 0) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`, "UNSUPPORTED_REASONING_EFFORT");
			} else {
				const effective = requested ?? reasoning.defaultEffort;
				if (effective !== void 0) {
					if (!reasoning.efforts.some((effort) => effort.id === effective)) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`, "UNSUPPORTED_REASONING_EFFORT");
					if (requested !== effective) resolvedConfig = {
						...defaulted,
						reasoningEffort: effective
					};
				}
			}
			return {
				config: resolvedConfig,
				...info.context === void 0 ? {} : { context: info.context },
				modelInfo: info
			};
		}
		/**
		* Resolve one call under its current adapter registration. The returned
		* one-shot handle keeps that registration across header logging and dispatch,
		* so HMR cannot combine one adapter's capability result with another adapter.
		* @param config - provider/model route and optional request controls.
		* @param signal - optional cancellation for adapter-owned capability lookup.
		* @returns a prepared config and its registration-bound stream entry point.
		*/
		async prepareCall(config, signal) {
			const registration = this.registration(config.provider);
			const adapterCall = await registration.adapter.prepareCall(config.provider, config.model, signal);
			const modelInfo = this.normalizeModelInfo(registration, config.model, adapterCall.model);
			const resolved = this.resolveCallWithInfo(config, modelInfo);
			const resolvedConfig = deepFreeze(structuredClone(resolved.config));
			const context = resolved.context === void 0 ? void 0 : deepFreeze(structuredClone(resolved.context));
			const adapterDefaults = deepFreeze({
				...config.reasoningEffort === void 0 && resolvedConfig.reasoningEffort !== void 0 ? { reasoningEffort: true } : {},
				...config.maxTokens === void 0 && resolvedConfig.maxTokens !== void 0 ? { maxTokens: true } : {}
			});
			let dispatched = false;
			return Object.freeze({
				config: resolvedConfig,
				retryPolicy: registration.retryPolicy,
				adapterDefaults,
				...context === void 0 ? {} : { context },
				...modelInfo.inputModalities === void 0 ? {} : { inputModalities: Object.freeze([...modelInfo.inputModalities]) },
				...modelInfo.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: modelInfo.systemPromptUpdate },
				stream: (options) => {
					if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
					if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
					dispatched = true;
					return this.streamWithRegistration(options, {
						registration,
						config: resolvedConfig,
						modelInfo,
						dispatch: (options) => adapterCall.stream(options)
					});
				}
			});
		}
		registration(provider) {
			const registration = this.adapters.get(provider);
			if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, "NO_ADAPTER");
			return registration;
		}
		/** Remove replay state whose historical route is owned by another adapter. */
		forAdapter(options, adapter) {
			const messages = options.messages.map((message) => {
				if (message.role !== "assistant") return message;
				const source = message.source;
				if (source.replayState === void 0) return message;
				if (this.adapters.get(source.provider)?.adapter === adapter) return message;
				return freezeMessage({
					...message,
					source: {
						kind: "model",
						provider: source.provider,
						model: source.model
					}
				});
			});
			if (messages.every((message, index) => message === options.messages[index])) return options;
			const filtered = {
				...options,
				messages
			};
			return Object.isFrozen(options) ? deepFreeze(filtered) : filtered;
		}
		/**
		* Resolve the current execution-world read path of one durable file
		* reference through the mounted attachment and filesystem providers.
		*/
		fileReadPath(ref) {
			let hostPath;
			try {
				hostPath = this.ctx.get("attachments")?.fileHostPath(ref);
			} catch {
				return;
			}
			if (hostPath === void 0) return void 0;
			return this.ctx.get("fs")?.processPathFromHostPath(hostPath);
		}
		/**
		* Final adapter boundary. Adapter selection, dispatch, iterator construction,
		* and iteration failures become one terminal failure chunk. Middleware and
		* downstream consumer failures remain thrown plugin or consumer errors.
		*/
		async *adapterStream(options, prepared) {
			let iterator;
			try {
				const registration = prepared?.registration ?? this.registration(options.provider);
				const adapter = registration.adapter;
				let modelInfo;
				let resolvedConfig;
				let dispatch;
				if (prepared === void 0) {
					const adapterCall = await adapter.prepareCall(options.provider, options.model, options.signal);
					modelInfo = this.normalizeModelInfo(registration, options.model, adapterCall.model);
					resolvedConfig = this.resolveCallWithInfo(options, modelInfo).config;
					dispatch = (options) => adapterCall.stream(options);
				} else {
					modelInfo = prepared.modelInfo;
					resolvedConfig = prepared.config;
					dispatch = prepared.dispatch;
				}
				if (prepared !== void 0 && !callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
				const resolvedOptions = callConfigEquals(options, resolvedConfig) ? options : Object.isFrozen(options) ? deepFreeze({
					...options,
					...resolvedConfig
				}) : {
					...options,
					...resolvedConfig
				};
				let projectedMessages = resolvedOptions.messages;
				if (projectedMessages.some((message) => contentHasFile(message.content))) projectedMessages = projectFilesToText(projectedMessages, (ref) => this.fileReadPath(ref));
				if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && projectedMessages.some((message) => contentHasImage(message.content))) projectedMessages = projectImagesForTextModel(projectedMessages);
				const projectedOptions = projectedMessages === resolvedOptions.messages ? resolvedOptions : Object.isFrozen(resolvedOptions) ? deepFreeze({
					...resolvedOptions,
					messages: projectedMessages
				}) : {
					...resolvedOptions,
					messages: projectedMessages
				};
				iterator = dispatch(this.forAdapter(projectedOptions, adapter))[Symbol.asyncIterator]();
			} catch (error) {
				yield adapterFailureChunk(error, options.signal);
				return;
			}
			let completed = false;
			try {
				while (true) {
					let item;
					try {
						const next = await iterator.next();
						item = next.done ? { done: true } : {
							done: false,
							value: next.value
						};
					} catch (error) {
						completed = true;
						yield adapterFailureChunk(error, options.signal);
						return;
					}
					if (item.done) {
						completed = true;
						return;
					}
					yield item.value;
				}
			} finally {
				if (!completed) {
					const close = iterator.return?.bind(iterator);
					if (close) await close();
				}
			}
		}
		/**
		* Stream one model call as raw chunks (token-level deltas). Replay state is
		* retained only when the same adapter instance owns its historical provider
		* and the target provider. Final adapter selection remains fixed through
		* asynchronous exact-model resolution and dispatch. Adapter selection,
		* dispatch, and iteration failures become terminal `error` or `aborted`
		* finish chunks; middleware, nested-call, cleanup, and consumer failures
		* remain thrown.
		* @param options - the full request; `options.provider` selects the adapter.
		* @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
		*/
		stream(options) {
			return this.streamWithRegistration(options);
		}
		streamWithRegistration(options, prepared) {
			return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
		}
	};
})();
/** Convert one adapter throw into the stream protocol's terminal outcome. */
function adapterFailureChunk(error, signal) {
	const failure = normalizeLlmFailure(error);
	return {
		type: "finish",
		reason: signal?.aborted || failure.code === "ABORTED" ? {
			kind: "aborted",
			failure
		} : {
			kind: "error",
			failure
		}
	};
}
//#endregion
//#region ../../core/session/lib/index.js
/**
* Brand a string as a {@link SessionId}.
* @param id - the raw session id string.
* @returns the same string with the session-id brand.
*/
function SessionId(id) {
	return brandString(id);
}
//#endregion
//#region ../../sandbox/sandbox/lib/index.js
/**
* The escalation vocabulary and choreography shared by every sandbox-enforcing
* tool family (`@deepseek-ai/dsh-tool-bash`, `@deepseek-ai/dsh-tool-fs`): the
* strictly-wider ladder, the argument-pairing validation, the model-facing
* denial/hint markers, and {@link approveEscalation} — the ordered fail-closed
* sequence that resolves a `sandbox_permissions` request through a
* user-approval channel BEFORE anything executes. One home keeps the two
* families' approval ordering and verbatim error texts from drifting apart.
*
* The channel is a minimal STRUCTURAL function shape ({@link EscalationAsk}),
* not the approval service type: the tool layer — which owns the agent, the
* call id, and the tool name — closes over `ctx.approval.request(...)` and
* hands the closure down, so this package never depends on the approval or
* agent packages.
*
* @module dsh-sandbox/escalation
*/
/**
* The strictly-wider table: what a call whose effective mode is the key may
* escalate TO. Checked at EXECUTION, never baked into a tool schema — the
* schema's enum is {@link ESCALATION_TARGETS}, because schemas are
* registry-global while the effective mode is per-call truth.
*/
const WIDER_MODES = {
	"read-only": ["workspace-write", "danger-full-access"],
	"workspace-write": ["danger-full-access"]
};
/**
* The closed escalation-target vocabulary — every mode a call could ever
* escalate TO (`read-only` is the floor; nothing escalates to it). Advertised
* whenever the mounted capability confines: cutting the enum down to the modes
* wider than the composition's DEFAULT would strand a session whose effective
* mode sits below it (a `danger-full-access` default would advertise nothing
* while a narrower-switched session stays confined with no lever).
*/
const ESCALATION_TARGETS = ["workspace-write", "danger-full-access"];
/**
* Validate the escalation argument pairing a tool schema cannot express:
* `sandbox_permissions` and `justification` travel together — an approval
* prompt without a reason, or a reason driving nothing, is a malformed ask —
* and the justification must be a non-empty sentence.
* @param sandboxPermissions - the raw `sandbox_permissions` argument, if given.
* @param justification - the raw `justification` argument, if given.
*/
function validateEscalationArgs(sandboxPermissions, justification) {
	if (sandboxPermissions !== void 0 && justification === void 0) throw new Error("invalid escalation: sandbox_permissions requires a justification");
	if (justification !== void 0 && sandboxPermissions === void 0) throw new Error("invalid escalation: justification is only valid together with sandbox_permissions");
	if (justification !== void 0 && justification.trim().length === 0) throw new Error("invalid justification: expected a non-empty sentence");
}
/**
* Resolve a sandbox permission request before execution. Repeating the call's
* effective mode returns it without approval. A strictly wider mode requires
* approval and applies only to this call. Narrower or unsupported targets,
* missing approval services or agents for widening, and non-grant outcomes
* throw before execution.
* @param request - the escalation to judge (see {@link EscalationRequest}).
* @param approval - the approval ingredients the tool holds (see {@link EscalationApproval}).
* @returns the granted mode, consumed by the one call that asked.
*/
async function approveEscalation(request, approval) {
	const { requestedMode: mode, effectiveMode, justification, subject } = request;
	if (mode === effectiveMode) return effectiveMode;
	if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode)) throw new Error(`sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`);
	if (approval.approver === void 0) throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval service is composed`);
	if (approval.agent === void 0) throw new Error(`sandbox escalation to "${mode}" requires approval, but the call has no agent to route it through`);
	const outcome = await approval.approver.request({
		agent: approval.agent,
		toolName: approval.toolName,
		callId: approval.callId,
		reason: `escalate sandbox to ${mode}: ${justification}`,
		...approval.signal ? { signal: approval.signal } : {}
	});
	switch (outcome) {
		case "allowed-once": return mode;
		case "rejected": throw new Error(`the user rejected escalating this ${subject} to "${mode}"`);
		case "cancelled": throw new Error(`approval for escalating to "${mode}" was cancelled`);
		case "unavailable": throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval channel is available`);
		default: return assertNever(outcome, "EscalationOutcome");
	}
}
//#endregion
//#region ../../core/tools/lib/index.js
/**
* Enforced JSON Schema subset shared by tool outputs, generated PTC mode
* types, subagents, and workflows. The subset accepts any JSON root, an
* annotation-only schema for unconstrained JSON, one scalar `type`, object
* `properties`/`required`/boolean `additionalProperties`, array `items`,
* type-correct scalar `enum`/`const`, and exact-one `oneOf`.
*
* Unsupported or misplaced keywords reject rather than being accepted without
* enforcement. Consumers that require an object root apply
* {@link assertObjectJsonSchema} before accepting input.
* @module dsh-tools/json-schema
*/
/**
* Thrown when a raw schema falls outside the enforced subset. `violations`
* lists every offending path instead of stopping at the first author error.
*/
var JsonSchemaError = class extends HarnessError {
	/** Individual schema violations in walk order. */
	violations;
	constructor(violations) {
		super(`unsupported JSON schema: ${violations.join("; ")}`, "UNSUPPORTED_SCHEMA");
		this.name = "JsonSchemaError";
		this.violations = violations;
	}
};
const CONSTRAINT_KEYWORDS = new Set([
	"type",
	"oneOf",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
]);
const ANNOTATION_KEYWORDS = new Set([
	"description",
	"title",
	"default",
	"examples"
]);
const SCHEMA_TYPES = [
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null"
];
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
/**
* Test for a realm-agnostic plain JSON record without accepting arrays or
* exotic objects.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the value has a plain-object prototype chain.
*/
function isPlainJsonRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
	} catch {
		return false;
	}
}
/** Whether an array uses one realm's intrinsic `Array.prototype`. */
function hasPlainArrayPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
/** Return whether a record contains only own enumerable string keys. */
function hasOnlyEnumerableStringKeys(value) {
	try {
		return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key));
	} catch {
		return false;
	}
}
/**
* Test for an ordinary schema record whose keys survive JSON projection.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the record has an intrinsic prototype and only own enumerable string keys.
*/
function isJsonSchemaRecord(value) {
	return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);
}
/**
* Test for a dense ordinary array with no JSON-invisible decorations.
* @param value - candidate array from any JavaScript realm.
* @returns Whether the array is intrinsic, dense, and undecorated.
*/
function isPlainJsonArray(value) {
	if (!Array.isArray(value)) return false;
	try {
		if (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
		for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
		return true;
	} catch {
		return false;
	}
}
/** Lossless finite JSON number, excluding negative zero. */
function isJsonNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
/** Whether a scalar is valid for one declared schema type. */
function scalarMatches(type, value) {
	switch (type) {
		case "string": return typeof value === "string";
		case "number": return isJsonNumber(value);
		case "integer": return isJsonNumber(value) && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		/* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */
		default: return assertNever(type, "JsonSchemaType");
	}
}
/** Keywords that are invalid beside `oneOf`. */
const ONE_OF_SIBLING_KEYWORDS = [
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
];
/** Validate object-only fields after its property schemas have been visited. */
function checkObjectSchemaTail(node, path, properties, violations) {
	const hasRequired = Object.hasOwn(node, "required");
	const required = hasRequired ? node.required : void 0;
	if (hasRequired) if (!isPlainJsonArray(required) || required.some((entry) => typeof entry !== "string")) violations.push(`${path}.required must be an array of strings`);
	else {
		const declared = isJsonSchemaRecord(properties) ? properties : {};
		for (const key of required) if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
	}
	if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") violations.push(`${path}.additionalProperties must be a boolean`);
}
/** Collect every violation for one raw schema tree without using the JavaScript call stack. */
function checkSchemaNode(root, rootPath, violations, seen) {
	const tasks = [{
		kind: "enter",
		node: root,
		path: rootPath
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.node);
			continue;
		}
		if (task.kind === "one-of-tail") {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`);
			continue;
		}
		if (task.kind === "object-tail") {
			checkObjectSchemaTail(task.node, task.path, task.properties, violations);
			continue;
		}
		const { node, path } = task;
		if (!isJsonSchemaRecord(node)) {
			violations.push(`${path} must be a schema object`);
			continue;
		}
		if (seen.has(node)) {
			violations.push(`${path} is circular`);
			continue;
		}
		seen.add(node);
		tasks.push({
			kind: "leave",
			node
		});
		for (const key of Object.keys(node)) {
			if (CONSTRAINT_KEYWORDS.has(key)) continue;
			if (ANNOTATION_KEYWORDS.has(key)) {
				try {
					if (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`);
				} catch {
					violations.push(`${path}.${key} annotation must be lossless JSON data`);
				}
				continue;
			}
			violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
		}
		if (Object.hasOwn(node, "description") && typeof node.description !== "string") violations.push(`${path}.description must be a string`);
		if (Object.hasOwn(node, "title") && typeof node.title !== "string") violations.push(`${path}.title must be a string`);
		const hasType = Object.hasOwn(node, "type");
		const hasOneOf = Object.hasOwn(node, "oneOf");
		if (hasType && hasOneOf) {
			violations.push(`${path} cannot declare both type and oneOf`);
			continue;
		}
		if (!hasType && !hasOneOf) {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);
			continue;
		}
		if (hasOneOf) {
			const oneOf = node.oneOf;
			tasks.push({
				kind: "one-of-tail",
				node,
				path
			});
			if (!isPlainJsonArray(oneOf) || oneOf.length < 2) violations.push(`${path}.oneOf must be an array of at least two schemas`);
			else for (let index = oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "enter",
				node: oneOf[index],
				path: `${path}.oneOf[${index}]`
			});
			continue;
		}
		const type = node.type;
		if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
			violations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);
			continue;
		}
		const schemaType = type;
		for (const [key, types] of Object.entries({
			properties: ["object"],
			required: ["object"],
			additionalProperties: ["object"],
			items: ["array"],
			enum: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			],
			const: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			]
		})) if (Object.hasOwn(node, key) && !types.includes(schemaType)) violations.push(`${path}.${key} is not supported on type "${schemaType}"`);
		switch (schemaType) {
			case "object": {
				const properties = Object.hasOwn(node, "properties") ? node.properties : void 0;
				tasks.push({
					kind: "object-tail",
					node,
					path,
					properties
				});
				if (Object.hasOwn(node, "properties")) if (!isJsonSchemaRecord(properties)) violations.push(`${path}.properties must be an object of schemas`);
				else {
					const entries = Object.entries(properties);
					for (let index = entries.length - 1; index >= 0; index--) {
						const entry = entries[index];
						/* v8 ignore next -- the loop is bounded by the captured entry count. */
						if (entry === void 0) continue;
						tasks.push({
							kind: "enter",
							node: entry[1],
							path: `${path}.properties.${entry[0]}`
						});
					}
				}
				break;
			}
			case "array":
				if (Object.hasOwn(node, "items")) tasks.push({
					kind: "enter",
					node: node.items,
					path: `${path}.items`
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null": {
				const hasEnum = Object.hasOwn(node, "enum");
				const allowed = hasEnum ? node.enum : void 0;
				const enumValid = isPlainJsonArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(schemaType, entry));
				if (hasEnum && !enumValid) violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);
				const hasConst = Object.hasOwn(node, "const");
				const declaredConst = hasConst ? node.const : void 0;
				const constValid = scalarMatches(schemaType, declaredConst);
				if (hasConst) {
					if (!constValid) violations.push(`${path}.const must be a ${schemaType} value`);
					else if (enumValid && !allowed.includes(declaredConst)) violations.push(`${path}.const must be one of ${path}.enum when both are declared`);
				}
				break;
			}
			/* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */
			default: assertNever(schemaType, "JsonSchemaType");
		}
	}
}
/**
* Assert that an arbitrary raw schema uses only the enforced subset.
* Annotation-only schemas are accepted as the standard unconstrained-JSON
* form; callers that require an object root use {@link assertObjectJsonSchema}.
* @param schema - untrusted raw JSON Schema.
* @returns Assertion that the schema belongs to the supported subset.
*/
function assertSupportedJsonSchema(schema) {
	const violations = [];
	checkSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());
	if (violations.length > 0) throw new JsonSchemaError(violations);
}
/** Safely test the lossless JSON boundary when a getter may throw. */
function safelyIsJsonValue(value) {
	try {
		return isJsonValue(value);
	} catch {
		return false;
	}
}
/** Root-aware diagnostic path for the parameter validator's empty sentinel. */
function diagnosticPath(path) {
	return path === "" ? "arguments" : path;
}
/** Append one object property without a leading dot at an implicit root. */
function propertyPath(path, key) {
	return path === "" ? key : `${path}.${key}`;
}
/** The generic exception-containment diagnostic owned by one valid schema node. */
function losslessValueViolation(path) {
	return [`"${diagnosticPath(path)}" must be a lossless JSON value`];
}
/** Append diagnostics without spreading a potentially wide child result as call arguments. */
function appendViolations(target, source) {
	for (const violation of source) target.push(violation);
}
/** Initialize one validation frame with empty aggregation state. */
function valueFrame(node, value, path) {
	return {
		node,
		value,
		path,
		catches: false,
		phase: "start",
		children: [],
		childIndex: 0,
		violations: [],
		tailViolations: [],
		matches: 0
	};
}
/** Validate one scalar node after its primitive type check. */
function checkScalarValue(node, value, path) {
	const allowed = Object.hasOwn(node, "enum") ? node.enum : void 0;
	if (allowed !== void 0 && !allowed.includes(value)) return [`"${diagnosticPath(path)}" must be one of ${JSON.stringify(allowed)}`];
	if (Object.hasOwn(node, "const") && value !== node.const) return [`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`];
	return [];
}
/** Validate one trusted schema/value pair with explicit frames rather than recursive calls. */
function checkValue(schema, value, path) {
	const frames = [valueFrame(schema, value, path)];
	let rootResult;
	const receive = (result) => {
		const parent = frames.at(-1);
		if (parent === void 0) {
			rootResult = result;
			return;
		}
		if (parent.kind === "oneOf") {
			if (result.length === 0) parent.matches++;
		} else appendViolations(parent.violations, result);
	};
	const finish = (result) => {
		frames.pop();
		receive(result);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		try {
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing schema-value child frame");
					frame.childIndex++;
					frames.push(valueFrame(child.node, child.value, child.path));
					continue;
				}
				if (frame.kind === "oneOf") {
					finish(frame.matches === 1 ? [] : [`"${diagnosticPath(frame.path)}" must match exactly one oneOf branch (matched ${frame.matches})`]);
					continue;
				}
				appendViolations(frame.violations, frame.tailViolations);
				if (frame.violations.length > 0) finish(frame.violations);
				else if (frame.kind === "object") finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a lossless JSON object`]);
				else finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a dense lossless JSON array`]);
				continue;
			}
			const nodeType = Object.hasOwn(frame.node, "type") ? frame.node.type : void 0;
			frame.catches = !(nodeType !== void 0 && !SCHEMA_TYPES.includes(nodeType));
			const oneOf = Object.hasOwn(frame.node, "oneOf") ? frame.node.oneOf : void 0;
			if (oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = Array.from(oneOf, (branch) => ({
					node: branch,
					value: frame.value,
					path: frame.path
				}));
				frame.childIndex = 0;
				frame.matches = 0;
				frame.phase = "children";
				continue;
			}
			if (nodeType === void 0) {
				finish(safelyIsJsonValue(frame.value) ? [] : losslessValueViolation(frame.path));
				continue;
			}
			switch (nodeType) {
				case "object": {
					if (!isPlainJsonRecord(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an object`]);
						break;
					}
					const properties = Object.hasOwn(frame.node, "properties") ? frame.node.properties ?? {} : {};
					const violations = [];
					const required = Object.hasOwn(frame.node, "required") ? frame.node.required ?? [] : [];
					for (const key of required) if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) violations.push(`missing required property "${propertyPath(frame.path, key)}"`);
					const children = [];
					for (const [key, child] of Object.entries(properties)) {
						if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) continue;
						children.push({
							node: child,
							value: frame.value[key],
							path: propertyPath(frame.path, key)
						});
					}
					const tailViolations = [];
					if (Object.hasOwn(frame.node, "additionalProperties") && frame.node.additionalProperties === false) {
						for (const key of Object.keys(frame.value)) if (!Object.hasOwn(properties, key)) tailViolations.push(`"${propertyPath(frame.path, key)}" is not a declared property (additionalProperties: false)`);
					}
					frame.kind = "object";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = violations;
					frame.tailViolations = tailViolations;
					frame.phase = "children";
					break;
				}
				case "array": {
					if (!Array.isArray(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an array`]);
						break;
					}
					const items = Object.hasOwn(frame.node, "items") ? frame.node.items : void 0;
					const children = items === void 0 ? [] : frame.value.flatMap((entry, index) => [{
						node: items,
						value: entry,
						path: `${frame.path}[${index}]`
					}]);
					frame.kind = "array";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = [];
					frame.phase = "children";
					break;
				}
				case "string":
					finish(typeof frame.value === "string" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a string`]);
					break;
				case "number":
					finish(typeof frame.value !== "number" ? [`"${diagnosticPath(frame.path)}" must be a number`] : !isJsonNumber(frame.value) ? [`"${diagnosticPath(frame.path)}" must be a finite JSON number`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "integer":
					finish(!isJsonNumber(frame.value) || !Number.isInteger(frame.value) ? [`"${diagnosticPath(frame.path)}" must be an integer`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "boolean":
					finish(typeof frame.value === "boolean" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a boolean`]);
					break;
				case "null":
					finish(frame.value === null ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be null`]);
					break;
				default: finish(assertNever(nodeType, "JsonSchemaType"));
			}
		} catch (error) {
			let failed = frames.pop();
			while (failed !== void 0 && !failed.catches) failed = frames.pop();
			if (failed === void 0) throw error;
			receive(losslessValueViolation(failed.path));
		}
	}
	/* v8 ignore next -- every root frame finishes or throws. */
	return rootResult ?? losslessValueViolation(path);
}
/**
* Validate a candidate value against an asserted raw schema. The function is
* total for arbitrary values and returns path-qualified violations.
* @param schema - a schema accepted by {@link assertSupportedJsonSchema}.
* @param value - the candidate JSON value.
* @param path - root label used in diagnostics.
* @returns All violations in walk order; empty means valid.
*/
function validateJsonSchemaValue(schema, value, path = "value") {
	return checkValue(schema, value, path);
}
/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */
const ANNOTATION_KEYS = [
	"description",
	"title",
	"default",
	"examples"
];
/** Throw one author-schema violation through the shared schema error type. */
function authorError(message) {
	throw new JsonSchemaError([message]);
}
/** Copy own annotation fields for validation by the raw-schema boundary. */
function copyAnnotations(source, target) {
	if (Object.hasOwn(source, "description")) target.description = source.description;
	if (Object.hasOwn(source, "title")) target.title = source.title;
	if (Object.hasOwn(source, "default")) target.default = source.default;
	if (Object.hasOwn(source, "examples")) target.examples = source.examples;
}
/** Reject author-only keys outside one node's declared vocabulary. */
function assertAuthorKeys(source, path, allowed) {
	for (const key of Object.keys(source)) if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`);
}
/** Install a compiled node without giving `__proto__` assignment semantics. */
function assignCompiledNode(destination, node) {
	switch (destination.kind) {
		case "root":
			destination.holder.value = node;
			break;
		case "property":
			Object.defineProperty(destination.target, destination.key, {
				value: node,
				enumerable: true,
				configurable: true,
				writable: true
			});
			break;
		case "item":
			destination.target.items = node;
			break;
		case "one-of":
			destination.target[destination.index] = node;
			break;
	}
}
/** Install a compiled property map at its root or containing object node. */
function assignCompiledPropertyMap(destination, compiled) {
	if (destination.kind === "root") destination.holder.value = compiled;
	else destination.target.properties = compiled.properties;
}
/** Execute an author-schema compilation task graph without recursive descent. */
function runSchemaCompiler(initial) {
	const seen = /* @__PURE__ */ new Set();
	const tasks = [initial];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.input);
			continue;
		}
		if (task.kind === "property-map-tail") {
			if (task.required.length > 0) {
				task.compiled.required = task.required;
				if (task.destination.kind === "object") task.destination.target.required = task.required;
			}
			continue;
		}
		if (task.kind === "property") {
			if (!isJsonSchemaRecord(task.property)) authorError(`${task.path} must be a value schema object`);
			if (Object.hasOwn(task.property, "required") && task.property.required !== true) authorError(`${task.path}.required must be true when present`);
			if (Object.hasOwn(task.property, "required") && task.property.required === true) task.required.push(task.key);
			tasks.push({
				kind: "value",
				input: task.property,
				path: task.path,
				allowRequired: true,
				destination: {
					kind: "property",
					target: task.properties,
					key: task.key
				}
			});
			continue;
		}
		if (task.kind === "property-map") {
			if (!isJsonSchemaRecord(task.input)) authorError(`${task.path} must be an object of value schemas`);
			if (seen.has(task.input)) authorError(`${task.path} is circular`);
			seen.add(task.input);
			const compiled = { properties: {} };
			const required = [];
			assignCompiledPropertyMap(task.destination, compiled);
			tasks.push({
				kind: "leave",
				input: task.input
			});
			tasks.push({
				kind: "property-map-tail",
				compiled,
				required,
				destination: task.destination
			});
			const entries = Object.entries(task.input);
			for (let index = entries.length - 1; index >= 0; index--) {
				const entry = entries[index];
				/* v8 ignore next -- the loop is bounded by the captured entry count. */
				if (entry === void 0) continue;
				tasks.push({
					kind: "property",
					property: entry[1],
					path: `${task.path}.${entry[0]}`,
					key: entry[0],
					properties: compiled.properties,
					required
				});
			}
			continue;
		}
		const { input, path } = task;
		if (!isJsonSchemaRecord(input)) authorError(`${path} must be a value schema object`);
		if (seen.has(input)) authorError(`${path} is circular`);
		seen.add(input);
		const authorKeys = [...ANNOTATION_KEYS, ...task.allowRequired ? ["required"] : []];
		const node = {};
		assignCompiledNode(task.destination, node);
		tasks.push({
			kind: "leave",
			input
		});
		if (Object.hasOwn(input, "oneOf")) {
			assertAuthorKeys(input, path, [
				...authorKeys,
				"oneOf",
				"type"
			]);
			if (Object.hasOwn(input, "type")) authorError(`${path} cannot declare both type and oneOf`);
			if (!isPlainJsonArray(input.oneOf)) authorError(`${path}.oneOf must be an array of at least two value schemas`);
			const branches = [];
			node.oneOf = branches;
			copyAnnotations(input, node);
			for (let index = input.oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "value",
				input: input.oneOf[index],
				path: `${path}.oneOf[${index}]`,
				allowRequired: false,
				destination: {
					kind: "one-of",
					target: branches,
					index
				}
			});
			continue;
		}
		const inputType = Object.hasOwn(input, "type") ? input.type : void 0;
		switch (inputType) {
			case "json":
				assertAuthorKeys(input, path, [...authorKeys, "type"]);
				copyAnnotations(input, node);
				break;
			case "object":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"properties",
					"additionalProperties"
				]);
				if (!Object.hasOwn(input, "additionalProperties") || typeof input.additionalProperties !== "boolean") authorError(`${path}.additionalProperties must be explicitly true or false`);
				node.type = "object";
				copyAnnotations(input, node);
				node.additionalProperties = input.additionalProperties;
				if (Object.hasOwn(input, "properties")) tasks.push({
					kind: "property-map",
					input: input.properties,
					path: `${path}.properties`,
					destination: {
						kind: "object",
						target: node
					}
				});
				break;
			case "array":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"items"
				]);
				node.type = "array";
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "items")) tasks.push({
					kind: "value",
					input: input.items,
					path: `${path}.items`,
					allowRequired: false,
					destination: {
						kind: "item",
						target: node
					}
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"enum",
					"const"
				]);
				node.type = inputType;
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "enum")) {
					if (!isPlainJsonArray(input.enum)) authorError(`${path}.enum must be a non-empty array of scalar values`);
					node.enum = Array.from(input.enum, (entry) => entry);
				}
				if (Object.hasOwn(input, "const")) node.const = input.const;
				break;
			default: authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`);
		}
	}
}
/** Compile one implicit property map, collecting per-property requiredness. */
function compilePropertyMap(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "property-map",
		input,
		path,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/** Compile one author node without applying any consumer root restriction. */
function compileValueSchema(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "value",
		input,
		path,
		allowRequired: false,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/**
* Compile one author-facing value schema to the enforced raw JSON Schema
* subset. The author-only `json` node becomes an annotation-only schema.
* @param spec - schema for any JSON-value root.
* @returns The asserted raw schema projection.
*/
function valueSchemaSpecToJsonSchema(spec) {
	const schema = compileValueSchema(spec, "schema");
	assertSupportedJsonSchema(schema);
	return schema;
}
/**
* Compile the implicit open parameter object into raw JSON Schema.
* @param spec - per-property parameter definitions.
* @returns An object-rooted raw schema with no implicit-root openness override.
*/
function parameterSchemaSpecToJsonSchema(spec) {
	const compiled = compilePropertyMap(spec, "parameters");
	const schema = {
		type: "object",
		properties: compiled.properties,
		...compiled.required === void 0 ? {} : { required: compiled.required }
	};
	assertSupportedJsonSchema(schema);
	return schema;
}
/** Invalid model-generated arguments for a typed tool. */
var ToolArgsError = class extends HarnessError {
	/** Individual violations in schema-walk order. */
	violations;
	constructor(violations) {
		super(`invalid arguments: ${violations.join("; ")}`, "INVALID_ARGS");
		this.name = "ToolArgsError";
		this.violations = violations;
	}
};
/**
* Define a first-party tool with inferred arguments and strict execution
* validation. Replay-only presenters validate softly and fall back to generic
* rendering for obsolete logged arguments.
* @param options - typed definition and optional finalizer and presenters.
* @returns A registry-ready definition.
*/
function defineTool(options) {
	const userExecute = options.execute;
	const userFinalizeContent = options.finalizeContent;
	const userRender = options.output.render;
	const userPresentationMeta = options.output.presentationMeta;
	const userPresentCall = options.presentCall;
	const userPresentResult = options.presentResult;
	const userIsConcurrencySafe = options.isConcurrencySafe;
	if (options.timeoutMs !== void 0 && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`);
	const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
	const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);
	const validate = (args) => validateJsonSchemaValue(parameters, args, "");
	const tool = {
		name: options.name,
		description: options.description,
		parameters,
		output: {
			schema: outputSchema,
			render(args, value) {
				return userRender(args, value);
			},
			...userPresentationMeta !== void 0 ? { presentationMeta(args, value) {
				return userPresentationMeta(args, value);
			} } : {}
		},
		...options.deferLoading === true ? { deferLoading: options.deferLoading } : {},
		...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
		async execute(args, exec) {
			const violations = validate(args);
			if (violations.length > 0) throw new ToolArgsError(violations);
			return userExecute(args, exec);
		}
	};
	if (userFinalizeContent) tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result);
	if (userPresentCall) tool.presentCall = (args) => {
		if (validate(args).length > 0) return void 0;
		return userPresentCall(args);
	};
	if (userPresentResult) tool.presentResult = (args, result) => {
		if (validate(args).length > 0) return void 0;
		return userPresentResult(args, result);
	};
	if (userIsConcurrencySafe) tool.isConcurrencySafe = (args) => {
		if (validate(args).length > 0) return false;
		return userIsConcurrencySafe(args);
	};
	return tool;
}
/**
* PTC mode `run_code` transport. Programs call the registry's agent-visible
* tools through nested executions scheduled under the native concurrency
* contract; each sub-dispatch is logged for reconstruction, while only the
* outer curated result enters model history.
* @module @deepseek-ai/dsh-tools/src/ptc
*/
/** The model-facing name of the PTC mode tool. */
const RUN_CODE_NAME = "run_code";
/**
* The TypeScript flavor: the fallback for a schema read with no runtime
* mounted ({@link resolveFlavor} owns which readers reach that). A real
* assembly always resolves a runtime first, so the model never sees this
* fallback outside its own language.
*/
const TYPESCRIPT_FLAVOR = {
	description: "Execute a TypeScript program against the available tools. Takes two required arguments: `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return is program output — curate it. Image-bearing subtool results are attached after the run.",
	codeDescription: "The program: the body of an async TypeScript function."
};
/** Per-language `run_code` schema flavors (see {@link RunCodeFlavor}); one entry per {@link PtcSdkLanguage}. */
const RUN_CODE_FLAVORS = {
	typescript: TYPESCRIPT_FLAVOR,
	python: {
		description: "Execute a Python program against the available tools. Takes two required arguments: `code`, the BODY of an async function (top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Use `print(...)` and/or `return <value>` for program output — curate it. Image-bearing subtool results are attached after the run.",
		codeDescription: "The program: the body of an async Python function."
	}
};
/**
* The `description` parameter's model-facing description: language-independent
* (the UI label contract is the same for every runtime), shared between the
* static spec and the language-aware `parameters` getter so the two emissions
* can never drift.
*/
const RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION = "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\".";
const RUN_CODE_CONTROLS = {
	timeoutMs: {
		type: "number",
		description: "Positive elapsed-time budget in milliseconds, capped by the deployment maximum."
	},
	sandbox_permissions: {
		type: "string",
		enum: [...ESCALATION_TARGETS],
		description: "Wider sandbox mode for this complete program execution; requires justification and approval."
	},
	justification: {
		type: "string",
		description: "Reason this complete program needs wider access, shown to the user for approval."
	}
};
function controlParameters(runtime) {
	if (runtime === void 0) return RUN_CODE_CONTROLS;
	return {
		...runtime.timeout === void 0 ? {} : { timeoutMs: {
			...RUN_CODE_CONTROLS.timeoutMs,
			description: `Positive elapsed-time budget in milliseconds, including nested tool and approval waits. Default ${runtime.timeout.defaultMs}; capped at ${runtime.timeout.maxMs}. Zero does not disable the deadline.`
		} },
		...runtime.sandboxMode === void 0 ? {} : {
			sandbox_permissions: RUN_CODE_CONTROLS.sandbox_permissions,
			justification: RUN_CODE_CONTROLS.justification
		}
	};
}
function escalationGuidance(runtime) {
	return runtime?.sandboxMode === void 0 ? "" : " A sandbox escalation approves this complete program for one execution only. Nested tools retain their own policies and approvals. Request wider access only after evidence of a denial. Earlier effects may already have completed: inspect them before explicitly retrying. Programs are never replayed automatically.";
}
/**
* Resolve the {@link RunCodeFlavor} for the loaded runtime's language, read at
* schema-emission time so the model-visible `run_code` schema always matches
* the SDK section's language. `peekRuntime` returns `undefined` only when no
* runtime is mounted, which reaches this function through definition readers
* and `schemas()` — the doc-catalog harvest is the only shipped one, and none
* of them feeds a model, because `wireSchemas` calls `requirePtcRuntime`
* before projecting — so that path degrades to {@link TYPESCRIPT_FLAVOR}. A
* mounted runtime whose language has no flavor entry fails loud, exactly as
* `requirePtcRuntime` rejects it at assembly. Keeping this table in step with
* `SDK_RENDERERS` is the compiler's job ({@link PtcSdkLanguage}); what this
* guard owns is the runtime-supplied language neither table knows, which never
* yields a wrong-language schema for a real runtime.
*/
function resolveFlavor(peekRuntime) {
	const runtime = peekRuntime();
	if (runtime === void 0) return TYPESCRIPT_FLAVOR;
	const flavor = RUN_CODE_FLAVORS[runtime.language];
	if (!Object.hasOwn(RUN_CODE_FLAVORS, runtime.language) || flavor === void 0) {
		const known = Object.keys(RUN_CODE_FLAVORS).map((name) => JSON.stringify(name)).join(", ");
		throw new Error(`dsh-tools: no run_code schema flavor registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
	}
	return flavor;
}
/**
* Thrown by `run_code` when the program run itself failed — a program
* exception, a budget expiry, an abort, or substrate death. Extends
* {@link HarnessError} (`code: 'CODE_RUN_FAILED'`); the registry's execution
* pipeline converts it into a structured `isError` result whose text carries
* the failure kind plus the captured logs, so the model can self-correct.
*/
var CodeRunFailedError = class extends HarnessError {
	constructor(message) {
		super(message, "CODE_RUN_FAILED");
		this.name = "CodeRunFailedError";
	}
};
/**
* Snapshot one binding call's argument as lossless JSON, then snapshot that
* detached value again so dispatch and logging stay independent without
* reintroducing structured-clone's platform-specific nesting limit.
*/
function jsonNormalizeArgs(value) {
	let snapshot;
	try {
		snapshot = snapshotJsonValue(value);
	} catch (error) {
		throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (snapshot === void 0) throw new Error("tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)");
	const logged = snapshotJsonValue(snapshot);
	/* v8 ignore next -- snapshot is already a detached lossless JSON value. */
	if (logged === void 0) throw new Error("tool arguments could not be detached for durable logging");
	return {
		dispatched: snapshot,
		logged
	};
}
/** Two-space JSON presentation, matching the existing shallow `run_code` text contract. */
const JSON_INDENT = "  ";
/**
* ECMAScript caps `JSON.stringify`'s `space` string at ten characters. The
* renderer also caps TOTAL indentation there, compacting deeper subtrees, so
* formatted output remains linear in the canonical JSON size.
*/
const MAX_JSON_INDENT_CHARS = 10;
/** Render one non-string JSON root without recursive traversal or unbounded indentation growth. */
function renderJsonValue(value) {
	const chunks = [];
	const tasks = [{
		kind: "value",
		value,
		depth: 0,
		compact: false
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "text") {
			chunks.push(task.text);
			continue;
		}
		const current = task.value;
		if (current === null || typeof current === "boolean" || typeof current === "number") {
			chunks.push(String(current));
			continue;
		}
		if (typeof current === "string") {
			chunks.push(JSON.stringify(current));
			continue;
		}
		const compact = task.compact || (task.depth + 1) * 2 > MAX_JSON_INDENT_CHARS;
		const childDepth = task.depth + 1;
		if (Array.isArray(current)) {
			chunks.push("[");
			if (current.length === 0) {
				chunks.push("]");
				continue;
			}
			tasks.push({
				kind: "text",
				text: compact ? "]" : `\n${JSON_INDENT.repeat(task.depth)}]`
			});
			for (let index = current.length - 1; index >= 0; index--) {
				const item = current[index];
				/* v8 ignore next -- canonical JsonValue arrays are dense. */
				if (item === void 0) throw new Error("cannot render a sparse JSON array");
				tasks.push({
					kind: "value",
					value: item,
					depth: childDepth,
					compact
				});
				tasks.push({
					kind: "text",
					text: compact ? index === 0 ? "" : "," : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}`
				});
			}
			continue;
		}
		const keys = Object.keys(current);
		chunks.push("{");
		if (keys.length === 0) {
			chunks.push("}");
			continue;
		}
		tasks.push({
			kind: "text",
			text: compact ? "}" : `\n${JSON_INDENT.repeat(task.depth)}}`
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) throw new Error("cannot render a missing JSON object key");
			const item = current[key];
			/* v8 ignore next -- canonical JsonValue records contain no undefined properties. */
			if (item === void 0) throw new Error("cannot render an undefined JSON object property");
			tasks.push({
				kind: "value",
				value: item,
				depth: childDepth,
				compact
			});
			tasks.push({
				kind: "text",
				text: compact ? `${index === 0 ? "" : ","}${JSON.stringify(key)}:` : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `
			});
		}
	}
	return chunks.join("");
}
/** Render one present program completion value for the model-facing result text. */
function renderValue(value) {
	return typeof value === "string" ? value : renderJsonValue(value);
}
/**
* Build the `run_code` {@link ToolDefinition}: required `code` and
* `description` parameters, executed through the dispatch bridge described
* above. The
* registry reserves it as presentation infrastructure under non-native modes,
* outside the filterable global/scoped capability layers.
* @param registry - the owning registry (sub-calls go through its `execute`,
*   bindings cover its registered tools).
* @param options - the registry-private capabilities described above.
* @returns the registry-ready definition.
*/
function createRunCodeTool(registry, options) {
	const { requireRuntime, peekRuntime, maxParallel, shapeDispatchLog } = options;
	const definition = defineTool({
		name: RUN_CODE_NAME,
		description: TYPESCRIPT_FLAVOR.description,
		parameters: {
			code: {
				type: "string",
				required: true,
				description: TYPESCRIPT_FLAVOR.codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			},
			...RUN_CODE_CONTROLS
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					logs: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					result: { type: "json" },
					sandbox: {
						type: "object",
						additionalProperties: false,
						properties: {
							mode: {
								type: "string",
								required: true,
								enum: [
									"read-only",
									"workspace-write",
									"danger-full-access"
								]
							},
							denied: {
								type: "boolean",
								required: true
							},
							enforcement: {
								type: "string",
								enum: ["full", "partial"]
							}
						}
					}
				}
			},
			render: (_args, value) => {
				const rendered = value.result === void 0 ? "" : renderValue(value.result);
				const parts = [value.logs.join("\n"), rendered].filter((part) => part.length > 0);
				if (value.sandbox?.enforcement === "partial") parts.push("File sandbox enforcement is partial on this host.");
				if (value.sandbox?.denied) parts.push(`The ${value.sandbox.mode} file sandbox denied an operation.${escalationGuidance(peekRuntime())}`);
				return [{
					type: "text",
					text: parts.length > 0 ? parts.join("\n") : "(run_code completed with no output)"
				}];
			}
		},
		async execute(args, exec) {
			if (args.description.trim().length === 0) throw new Error("invalid description: expected a non-empty string");
			const runtime = requireRuntime();
			validateEscalationArgs(args.sandbox_permissions, args.justification);
			if (args.timeoutMs !== void 0 && runtime.timeout === void 0) throw new Error("timeoutMs is not available for this PTC runtime");
			if (args.timeoutMs !== void 0 && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) throw new Error("invalid timeoutMs: expected a positive finite number");
			const standingPolicy = runtime.sandboxMode === void 0 ? void 0 : options.resolveSandboxPolicy(exec);
			let policy = standingPolicy;
			if (args.sandbox_permissions !== void 0 && args.justification !== void 0) {
				if (standingPolicy === void 0) throw new Error("sandbox_permissions is not available for this PTC runtime");
				const approvedMode = await approveEscalation({
					requestedMode: args.sandbox_permissions,
					justification: args.justification,
					effectiveMode: standingPolicy.mode,
					subject: "program"
				}, {
					approver: options.peekApprover(),
					agent: exec.agent,
					callId: exec.callId,
					toolName: RUN_CODE_NAME,
					signal: exec.signal
				});
				policy = {
					...standingPolicy,
					mode: approvedMode
				};
			}
			exec.signal.throwIfAborted();
			const runController = new AbortController();
			const onOuterAbort = () => {
				runController.abort(exec.signal.reason);
			};
			exec.signal.addEventListener("abort", onOuterAbort, { once: true });
			let dispatches = 0;
			const pendingQueue = [];
			const inFlight = /* @__PURE__ */ new Set();
			/** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
			const logWork = /* @__PURE__ */ new Set();
			const commitQueue = [];
			let exclusiveActive = false;
			let driving = false;
			let driverRun = Promise.resolve();
			let wake;
			const wakeup = () => {
				const release = wake;
				wake = void 0;
				release?.();
			};
			/**
			* The single ordered lane. Each pass commits the head-of-line settled
			* dispatch (ordered post-execute), then starts the next queued entry if
			* its slot is free (ordered pre-execute), and otherwise sleeps until a
			* body settles or a new submission arrives. One run reaching the
			* empty-queues/empty-pool state is quiescence.
			*/
			const drive = () => {
				if (driving) return driverRun;
				driving = true;
				driverRun = (async () => {
					try {
						for (;;) {
							const signal = new Promise((resolve) => {
								wake = resolve;
							});
							const commitHead = commitQueue[0];
							if (commitHead !== void 0 && commitHead.settled) {
								commitQueue.shift();
								await commitHead.commit();
								if (commitHead.mode === "exclusive") exclusiveActive = false;
								continue;
							}
							const head = pendingQueue[0];
							if (head !== void 0) {
								if (runController.signal.aborted) {
									pendingQueue.shift();
									head.abandon();
									continue;
								}
								const mode = head.classify();
								if (!exclusiveActive && (mode === "exclusive" ? inFlight.size === 0 : inFlight.size < maxParallel)) {
									if (mode === "exclusive") exclusiveActive = true;
									head.mode = mode;
									pendingQueue.shift();
									commitQueue.push(head);
									await head.start();
									const flight = head.flight.finally(() => {
										inFlight.delete(flight);
										wakeup();
									});
									inFlight.add(flight);
									continue;
								}
							}
							if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return;
							await signal;
						}
					} finally {
						driving = false;
						wake = void 0;
					}
				})();
				return driverRun;
			};
			/** Every dispatch settled AND committed; nothing can start (the run is aborted at call time). */
			const drainDispatches = async () => {
				await drive();
				while (logWork.size > 0) await Promise.allSettled([...logWork]);
			};
			const runOver = () => runController.signal.aborted;
			const binding = (schema) => async (rawArgs) => {
				const { name } = schema;
				if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} not dispatched`);
				const normalized = jsonNormalizeArgs(rawArgs);
				const n = ++dispatches;
				const subCallId = brandString(`${String(exec.callId)}:ptc:${n}`);
				const input = {
					callId: subCallId,
					rootCallId: exec.rootCallId,
					name,
					schema,
					arguments: normalized.dispatched,
					...exec.agent ? { agent: exec.agent } : {},
					parent: exec.token,
					signal: runController.signal
				};
				const scheduler = registry[TOOL_RUNTIME_SCHEDULER];
				const outcome = await new Promise((resolve, reject) => {
					let parked;
					const settle = (result) => {
						resolve(result.isError ? {
							isError: true,
							message: result.error.message
						} : {
							isError: false,
							value: result.value
						});
						const agent = exec.agent;
						if (agent === void 0) return;
						const task = (async () => {
							const logged = await shapeDispatchLog({
								exec,
								agent,
								subCallId,
								name,
								isError: result.isError,
								content: result.content
							});
							agent.session.append("tool/ptc-dispatch", {
								rootCallId: exec.rootCallId,
								parentCallId: exec.callId,
								subCallId,
								name,
								arguments: normalized.logged,
								isError: result.isError,
								...result.error?.info === void 0 ? {} : { error: result.error.info },
								content: logged
							});
						})().finally(() => {
							logWork.delete(task);
						});
						logWork.add(task);
					};
					pendingQueue.push({
						flight: Promise.resolve(),
						settled: false,
						classify: () => registry.executionMode(input).kind,
						abandon: () => {
							reject(/* @__PURE__ */ new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`));
						},
						async start() {
							exec.agent?.session.append("tool/ptc-dispatch-start", {
								rootCallId: exec.rootCallId,
								parentCallId: exec.callId,
								subCallId,
								name,
								arguments: normalized.logged
							});
							const prepared = await scheduler.prepare(input);
							if (prepared.kind === "dispatch") {
								this.flight = scheduler.dispatch(prepared.exec).then((dispatchOutcome) => {
									parked = {
										kind: dispatchOutcome.kind,
										exec: prepared.exec,
										result: dispatchOutcome.result
									};
									this.settled = true;
								});
								return;
							}
							parked = {
								kind: prepared.kind,
								exec: prepared.exec,
								result: prepared.result
							};
							this.settled = true;
						},
						async commit() {
							/* v8 ignore next -- commit() runs only after `settled` flipped, which set parked. */
							if (parked === void 0) return;
							const result = parked.kind === "post-result" ? await scheduler.finalize(parked.exec, parked.result) : scheduler.finish(parked.exec, parked.result);
							if (!result.isError && result.content.some((block) => block.type === "image")) exec.deferContext(createUserMessage({
								content: result.content,
								source: { kind: "ptc-mode" }
							}));
							for (const context of result.additionalContexts ?? []) exec.deferContext(context);
							if (result.concludesTurn) exec.concludeTurn();
							settle(result);
							while (logWork.size > maxParallel) await Promise.race(logWork);
						}
					});
					wakeup();
					drive();
				});
				if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} result discarded`);
				if (outcome.isError) throw new Error(outcome.message);
				return outcome.value;
			};
			const functions = Object.create(null);
			for (const schema of registry.schemas(exec.agent)) {
				if (schema.name === "run_code") continue;
				Object.defineProperty(functions, schema.name, {
					enumerable: true,
					value: binding(deepFreeze(schema))
				});
			}
			try {
				let result;
				try {
					result = await runtime.run(runtime.resolve({
						program: args.code,
						bindings: [{
							global: "tools",
							functions,
							errorClass: {
								name: "ToolCallError",
								memberNameProperty: "toolName"
							}
						}],
						signal: runController.signal,
						...exec.agent?.session.header.cwd !== void 0 ? { cwd: exec.agent.session.header.cwd } : {},
						...policy !== void 0 ? { sandboxPolicy: policy } : {},
						...args.timeoutMs !== void 0 ? { timeoutMs: args.timeoutMs } : {}
					}));
				} finally {
					runController.abort("run_code settled");
					await drainDispatches();
				}
				if (result.error) {
					const logsText = result.logs.length > 0 ? `\nCaptured output:\n${result.logs.join("\n")}` : "";
					const sandboxText = result.sandbox === void 0 ? "" : `\nFile sandbox: ${result.sandbox.mode}${result.sandbox.enforcement === void 0 ? "" : `; enforcement: ${result.sandbox.enforcement}`}${result.sandbox.denied ? "; operation denied" : ""}.`;
					throw new CodeRunFailedError(`code run failed (${result.error.kind}): ${result.error.message}${logsText}${sandboxText}${result.sandbox?.denied ? escalationGuidance(runtime) : ""}`);
				}
				return {
					logs: result.logs,
					...result.sandbox === void 0 ? {} : { sandbox: result.sandbox },
					...result.value !== void 0 ? { result: result.value } : {}
				};
			} finally {
				exec.signal.removeEventListener("abort", onOuterAbort);
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.description,
			kind: "execute",
			rawInput: args.code
		})
	});
	Object.defineProperty(definition, "description", {
		enumerable: true,
		get: () => {
			const runtime = peekRuntime();
			const instructions = runtime?.executionInstructions;
			return resolveFlavor(peekRuntime).description + (instructions ? ` ${instructions}` : "") + (runtime === void 0 ? "" : " The working directory is the Session's current directory.") + escalationGuidance(runtime);
		}
	});
	Object.defineProperty(definition, "parameters", {
		enumerable: true,
		get: () => parameterSchemaSpecToJsonSchema({
			code: {
				type: "string",
				required: true,
				description: resolveFlavor(peekRuntime).codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			},
			...controlParameters(peekRuntime())
		})
	});
	return definition;
}
/**
* PTC mode codegen: the pure projection from registered tool schemas to the TypeScript SDK
* text the model programs against (the `tools:sdk` prompt section). Sibling of
* `json-schema.ts` — `schemas()` (native function calling) and this module (the generated
* `declare const tools` API) are two projections of the same store.
* @module @deepseek-ai/dsh-tools/src/ts-types
*/
/** Property names that are valid bare TS identifiers; anything else is quoted. */
const IDENTIFIER$1 = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Render an object key: bare when it is a valid identifier, quoted otherwise (every name stays reachable, no aliasing). */
function renderKey(name) {
	return IDENTIFIER$1.test(name) ? name : JSON.stringify(name);
}
/** One `indent`-deep line prefix (two spaces per level). */
function pad$1(indent) {
	return "  ".repeat(indent);
}
/** A one-line JSDoc block for a schema `description`, or no lines when there is none. */
function docLines$1(description, indent) {
	if (typeof description !== "string" || description.length === 0) return [];
	const collapsed = description.replace(/\s+/g, " ").trim();
	return [`${pad$1(indent)}/** ${collapsed.replaceAll("*/", String.raw`*\/`)} */`];
}
/** Render one scalar already validated by the unified schema boundary. */
function renderScalar(value) {
	return JSON.stringify(value);
}
/** Render a validated scalar `const`/`enum`, falling back to the broad type. */
function renderConstrainedScalar$1(node, type) {
	const broad = type === "integer" ? "number" : type;
	if (Object.hasOwn(node, "const")) return renderScalar(node.const);
	if (Object.hasOwn(node, "enum")) return node.enum.map(renderScalar).join(" | ");
	return broad;
}
/** Build one document from captured parts while retaining the legacy array-parenthesization test. */
function typeDocumentFrom(parts) {
	return {
		parts,
		containsUnionOrIntersection: parts.some((part) => typeof part === "string" ? part.includes("|") || part.includes("&") : part.containsUnionOrIntersection)
	};
}
/** Build a small document without an intermediate array at each call site. */
function typeDocument(...parts) {
	return typeDocumentFrom(parts);
}
/** Flatten a nested document with an explicit work stack. */
function flattenTypeDocument(document) {
	const chunks = [];
	const tasks = [document];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (typeof task === "string") {
			chunks.push(task);
			continue;
		}
		for (let index = task.parts.length - 1; index >= 0; index--) {
			const part = task.parts[index];
			/* v8 ignore next -- the loop is bounded by the captured part count. */
			if (part !== void 0) tasks.push(part);
		}
	}
	return chunks.join("");
}
/** Initialize one schema-render frame with empty aggregation state. */
function schemaRenderFrame(node, indent) {
	return {
		node,
		indent,
		phase: "start",
		children: [],
		childIndex: 0,
		childDocuments: [],
		entries: []
	};
}
/** Render an already asserted schema to a composable document. */
function renderSupportedSchema(schema, indent) {
	const frames = [schemaRenderFrame(schema, indent)];
	let rootDocument;
	const finish = (document) => {
		frames.pop();
		const parent = frames.at(-1);
		if (parent === void 0) rootDocument = document;
		else parent.childDocuments.push(document);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		if (frame.phase === "children") {
			if (frame.childIndex < frame.children.length) {
				const child = frame.children[frame.childIndex];
				/* v8 ignore next -- childIndex is bounded by children.length. */
				if (child === void 0) throw new Error("missing schema render child");
				frame.childIndex++;
				frames.push(schemaRenderFrame(child.node, child.indent));
				continue;
			}
			if (frame.kind === "oneOf") {
				const parts = [];
				for (let index = 0; index < frame.childDocuments.length; index++) {
					if (index > 0) parts.push(" | ");
					const child = frame.childDocuments[index];
					/* v8 ignore next -- child documents correspond one-to-one with children. */
					if (child !== void 0) parts.push(child);
				}
				finish(typeDocumentFrom(parts));
				continue;
			}
			if (frame.kind === "array") {
				const child = frame.childDocuments[0];
				/* v8 ignore next -- array frames always schedule exactly one child. */
				if (child === void 0) throw new Error("missing array item type");
				finish(child.containsUnionOrIntersection ? typeDocument("(", child, ")[]") : typeDocument(child, "[]"));
				continue;
			}
			const required = new Set(frame.node.required);
			const parts = ["{"];
			for (let index = 0; index < frame.entries.length; index++) {
				const entry = frame.entries[index];
				const child = frame.childDocuments[index];
				/* v8 ignore next -- object entries and child documents have the same length. */
				if (entry === void 0 || child === void 0) throw new Error("missing object property type");
				const [name, prop] = entry;
				for (const line of docLines$1(prop.description, frame.indent + 1)) parts.push("\n", line);
				parts.push("\n", `${pad$1(frame.indent + 1)}${renderKey(name)}${required.has(name) ? "" : "?"}: `, child, ";");
			}
			parts.push("\n", `${pad$1(frame.indent)}}`);
			const declared = typeDocumentFrom(parts);
			finish(frame.node.additionalProperties === false ? declared : typeDocument(declared, " & Record<string, JsonValue>"));
			continue;
		}
		const node = frame.node;
		if (node.oneOf !== void 0) {
			frame.kind = "oneOf";
			frame.children = Array.from(node.oneOf, (child) => ({
				node: child,
				indent: frame.indent
			}));
			frame.childIndex = 0;
			frame.childDocuments = [];
			frame.phase = "children";
			continue;
		}
		if (node.type === void 0) {
			finish(typeDocument("JsonValue"));
			continue;
		}
		switch (node.type) {
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				finish(typeDocument(renderConstrainedScalar$1(node, node.type)));
				break;
			case "array":
				if (node.items === void 0) finish(typeDocument("JsonValue[]"));
				else {
					frame.kind = "array";
					frame.children = [{
						node: node.items,
						indent: frame.indent
					}];
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			case "object": {
				const open = node.additionalProperties !== false;
				const entries = Object.entries(node.properties ?? {});
				if (entries.length === 0) finish(typeDocument(open ? "Record<string, JsonValue>" : "Record<string, never>"));
				else {
					frame.kind = "object";
					frame.entries = entries;
					frame.children = entries.map(([, child]) => ({
						node: child,
						indent: frame.indent + 1
					}));
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			}
			/* v8 ignore next -- assertSupportedJsonSchema narrowed this closed type union. */
			default: finish(typeDocument("unknown"));
		}
	}
	/* v8 ignore next -- every root frame produces one document. */
	return rootDocument ?? typeDocument("unknown");
}
/**
* Map one enforced JSON-Schema node to a TypeScript type literal. Supports
* every unified schema construct and returns `unknown` for malformed or
* unsupported inputs without throwing.
* @param schema - the JSON-Schema node (any shape; hostile inputs degrade).
* @param indent - the indentation level for nested object members.
* @returns the TS type text (multi-line for objects with properties).
*/
function jsonSchemaToTs(schema, indent = 0) {
	try {
		assertSupportedJsonSchema(schema);
		return flattenTypeDocument(renderSupportedSchema(schema, indent));
	} catch {
		return "unknown";
	}
}
/** The fixed model-facing usage contract rendered above the declarations (see the PTC mode Agent Note's "What the model sees"). */
const SDK_INSTRUCTIONS$1 = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async TypeScript function (erasable syntax only — no \`enum\` or namespaces; type annotations are advisory, the code runs type-stripped) — and \`description\`, a short summary of what the program does. The declarations below are SDK bindings for this program. A declaration does not make its name a directly callable tool; only names supplied as separate tool schemas may be called directly.`;
const SDK_PROGRAM_INSTRUCTIONS = `Inside the program:

- Call tools as \`await tools.name(args)\` — quoted access for exotic names: \`tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value. Tool arguments must be lossless JSON.
- A FAILED tool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose \`message\` is human-readable — \`try/catch\` it to handle and continue.
- Independent read-only calls MAY overlap under \`Promise.all\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit results with \`return\` and/or \`console.log(...)\`. Only what you print or return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

Program-only SDK bindings:`;
/** Whether one string schema accepts the literal used by the bash example. */
function acceptsExampleString(schema, value) {
	return schema?.type === "string" && (schema.const === void 0 || schema.const === value) && (schema.enum === void 0 || schema.enum.includes(value));
}
/** Render the bash example only when its literal arguments satisfy the current parameter schema. */
function renderBashExample(schemas) {
	const bash = schemas.find((schema) => schema.name === "bash");
	if (bash === void 0) return "";
	const parameters = bash.parameters;
	if (parameters.type !== "object") return "";
	const required = parameters.required ?? [];
	if (required.some((name) => name !== "command" && name !== "description")) return "";
	if (!acceptsExampleString(parameters.properties?.command, "pwd")) return "";
	const needsDescription = required.includes("description");
	if (needsDescription && !acceptsExampleString(parameters.properties?.description, "Show current directory")) return "";
	return ` When no separate \`bash\` schema is supplied, invoke a declared \`bash\` binding inside \`run_code\`:\n\n\`run_code({ code: "return await tools.bash({ command: 'pwd'${needsDescription ? ", description: 'Show current directory'" : ""} })", description: "Show current directory" })\``;
}
/**
* Render the full `tools:sdk` prompt section: the fixed usage instructions
* plus one `declare const tools` interface covering every given tool.
* Deterministic — tools are emitted in lexicographic name order, so an
* unchanged tool set produces byte-identical text across assemblies. The sort
* is not a total order on byte-equal names, so two schemas sharing a name
* would render in argument order; the caller's visible-capability map is keyed
* by name, so the input never carries a duplicate.
* @param schemas - the tool schemas to declare (the caller excludes
*   `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdk(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const argsMembers = [];
	const outputMembers = [];
	for (const schema of sorted) {
		argsMembers.push(...docLines$1(schema.description, 1));
		argsMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.parameters, 1)};`);
		outputMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.output, 1)};`);
	}
	const declaration = [
		`interface ToolArgsMap {${argsMembers.length > 0 ? `\n${argsMembers.join("\n")}\n` : ""}}`,
		`interface ToolOutputMap {${outputMembers.length > 0 ? `\n${outputMembers.join("\n")}\n` : ""}}`,
		"type ToolName = keyof ToolOutputMap",
		[
			"declare class ToolCallError extends Error {",
			"  readonly name: \"ToolCallError\";",
			"  readonly toolName: ToolName;",
			"}"
		].join("\n"),
		[
			"declare const tools: {",
			"  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;",
			"}"
		].join("\n")
	].join("\n\n");
	return `${SDK_INSTRUCTIONS$1}${renderBashExample(sorted)}\n\n${SDK_PROGRAM_INSTRUCTIONS}\n\n\`\`\`ts\ntype JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }\n\n${declaration}\n\`\`\``;
}
/**
* PTC mode codegen — Python flavor. The pure projection from registered tool schemas to the
* Python SDK text the model programs against under `runtime.language === 'python'`. Sibling of
* {@link ./ts-types.ts | ts-types.ts}; the two files are two projections of the same registry
* store, keyed by the loaded {@link @deepseek-ai/dsh-ptc-runtime#PtcRuntime.language | PTC
* runtime's language}.
*
* Under `mode: 'ptc'` the native tool schemas are omitted from the request, so this generated
* SDK is the model's ONLY source for each tool's argument names, required fields, types,
* descriptions, and canonical output shapes; under `mode: 'both'` the native schemas ship
* alongside it and it is one of two. Object-shaped arguments and outputs therefore render as one
* named `TypedDict` per tool (and per nested object), not an opaque `dict[str, Any]`, so the
* shape survives into the program under the mode that has nothing else to carry it.
* @module @deepseek-ai/dsh-tools/src/py-types
*/
/**
* The reference grammar's `xid_start xid_continue*` — the set
* `str.isidentifier()` accepts on a CPython whose Unicode tables match the
* engine's. See {@link isBareIdentifier} for what a version skew does.
*/
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;
/**
* Whether a name can be emitted as a bare Python identifier rather than
* routed to the subscript/`dict[str, Any]` path.
*
* Python identifiers are not ASCII: `路径` is as legal a field name as `path`,
* and rejecting it would degrade the whole enclosing object, dropping every
* field's name, requiredness, and type — information whose only source under
* `mode: 'ptc'` is this generated text.
*
* NFKC stability is a second and separate condition, because CPython
* normalizes identifiers at compile time while JSON keys are compared as
* written: `ﬁeld` would be declared and reachable as `field`, so the SDK would
* advertise a key under a spelling the harness never accepts, and two keys
* that normalize together would collapse into one declaration. Those names
* take the subscript path, which carries their exact bytes.
*
* `IDENTIFIER` matches `str.isidentifier()` (measured on Node 22.23.1 vs
* CPython 3.9.6 tables): the equivalence holds inside the two versions' shared
* tables, and the skew characters below are exactly where that pair diverges.
* The predicate as a whole is deliberately stricter than `isidentifier()`,
* which does not test NFKC stability: `'ﬁeld'.isidentifier()` is True and
* this returns false.
*
* Both conditions are evaluated against the ENGINE's Unicode tables, and the
* two sides are versioned independently — `\p{XID_Start}`/`\p{XID_Continue}`
* follow the running engine (Node 22.23.1 reports Unicode 17.0) while CPython
* follows its own (3.9.6 reports 13.0.0). The skew is not symmetric. A CPython
* older than the engine is the dangerous direction: a character added to either
* property since its tables (U+10570 Vithkuqi and U+1E290 Toto, 14.0; U+1E4D0
* Nag Mundari, 15.0; U+1C89 Cyrillic TJE, 16.0 — ages per `DerivedAge.txt`; all
* four are NFKC-stable and accepted here, and all four are `Cn` on that 3.9.6,
* which rejects them) is emitted bare and its tokenizer refuses the character,
* taking the whole SDK block down — the same parseability invariant
* {@link UNPRINTABLE}, {@link LONE_SURROGATE} and {@link MAX_LIST_NESTING}
* exist for. Both properties carry it: a character added only to `XID_Continue`
* passes the trailing `\p{XID_Continue}*` in a tail position and fails the same
* way — U+200C ZWNJ and U+200D ZWJ are that case, gaining `XID_Continue` in UCD
* 15.1 and absent from it in 13.0.0, 14.0.0 and 15.0.0, so `a\u{200C}b` is
* emitted bare here while `isidentifier()` is False on 3.9.6 and on 3.12.13
* (15.0.0). A CPython newer than the engine only routes a legal name to the
* subscript/`dict[str, Any]` path: less readable, still correct. The NFKC
* condition reduces to the same skew, since normalization stability guarantees
* an assigned character's normalization never changes afterwards.
*
* This predicate is not the only reader of engine tables. {@link camelCase}
* reads them at three further points — its split set, its head test, and its
* `toUpperCase()` case mapping — and this predicate's verdict gates none of
* them: a class name derived there reaches emitted text whenever any object
* shape in the tool's schema declares a `TypedDict`, including for a tool this
* predicate rejected. A tool named `zz-\u{1E4D0}x` with such parameters never
* reaches the skew here (the `-` rejects it outright) yet emits `class
* Zz\u{1E4D0}xArgs`, which that same 3.9.6 refuses — Nag Mundari arrived two
* releases after its tables. The case mapping is a separate table rather than
* an XID membership test, and it fails on names both conditions above accept:
* `\u{019B}` is XID_Start and NFKC-stable, so this predicate accepts it and
* `async def \u{019B}` compiles on 3.9.6, but Node uppercases it to
* `\u{A7DC}` — unassigned in that CPython, whose own `.upper()` is the identity
* here — and the declared `class \u{A7DC}Args` fails with `invalid
* non-printable character U+A7DC`. Closing the exposure therefore covers all
* four read points, not this predicate alone; it needs the target interpreter's
* version, which the backend reporting `language: 'python'` owns; the
* language-dispatch Agent Note records the deferral.
*
* The `ts-types` sibling keeps its own ASCII rule rather than sharing this
* one: ECMAScript identifiers are a different set (`$`) and are never
* normalized, so one predicate cannot be correct for both. ZWJ/ZWNJ are not
* part of that difference — both sets carry them on the engine's tables; what
* separates the two there is the CPython table version above.
* @param name - the raw schema field or tool name.
* @returns whether the name can be emitted bare.
*/
function isBareIdentifier(name) {
	return IDENTIFIER.test(name) && name.normalize("NFKC") === name;
}
/**
* Python hard keywords: reserved everywhere, so a tool or field named
* ``class`` or ``lambda`` is legal on the wire but not as an attribute
* (``tools.class`` would be a SyntaxError in the model program) and not as a
* class-syntax `TypedDict` field. Such a tool renders under subscript access
* and such an object degrades to ``dict[str, Any]`` — the model still reaches
* every tool and field without collisions.
* Soft keywords (``match``, ``case``, ``type``, ``_`` — the language
* reference's whole set) are deliberately ABSENT: each is special in exactly
* one syntactic position — a statement head (``match``, ``type``), a ``match``
* statement's clause head (``case``), or a pattern (``_``) — so ``match: str``
* as a field and ``async def match(...)`` as a method are both legal, and
* including them would needlessly degrade common search/regex tool fields to
* ``dict[str, Any]``. Underscore-leading names are handled separately, not
* here: a non-dunder ``__token`` name-mangles, a dunder present on
* ``object``/``type`` resolves before the proxy hook, and implicit
* special-method lookup bypasses the hook.
*/
const RESERVED = new Set([
	"False",
	"None",
	"True",
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
	"__debug__"
]);
/** `typing` symbols this module may emit, in the deterministic import order. */
const TYPING_ORDER = [
	"Any",
	"Literal",
	"NotRequired",
	"Protocol",
	"TypedDict"
];
/** `indent`-deep line prefix (four spaces per level to match PEP 8 output). */
function pad(indent) {
	return "    ".repeat(indent);
}
/**
* The `Cc` code points that survive the whitespace collapse in {@link describe}
* and have no printable form: the C0 controls, DEL, and the C1 controls. Only
* U+0009 to U+000D are absent, because ECMAScript `\s` already collapsed them —
* `\s` is TAB/VT/FF/SP/NBSP/ZWNBSP/Zs plus LF/CR/LS/PS, so no C1 code point is
* in it and the whole U+0080 to U+009F block reaches this rule intact. Those
* are not hypothetical input: they are what Windows-1252 bytes 0x80 to 0x9F
* (smart quotes, em dash) become when decoded as Latin-1.
* CPython rejects source containing a NUL outright
* (`SyntaxError: source code string cannot contain null bytes`), whether it
* sits in a docstring or in a comment, so one such byte anywhere in a schema
* description would make the whole generated SDK unparseable — under
* `mode: 'ptc'`, the model's only declaration of the tools. The rest are
* legal but invisible; escaping them with the same rule keeps the emitted text
* readable and the treatment uniform.
*
* The boundary is the category, not per-code-point addressability: `\xNN`
* addresses U+0000 to U+00FF, so one escape form covers `Cc` exactly. The
* invisible `Cf` formatting characters pass through by design — of them only
* U+00AD soft hyphen would fit `\xNN` at all, and escaping that one while
* U+200B ZWSP, U+200E/U+200F bidi marks, and U+2060 word joiner passed through
* would leave a rule that is neither category- nor addressability-shaped. The
* whole family is legal in both consumers, since only LF and CR terminate a
* Python string literal or a `#` comment. That set is the tokenizer's, not
* `str.splitlines()`': NEL (U+0085), LS (U+2028), and PS (U+2029) split a
* string at run time but do not end a physical line in source — measured on
* CPython 3.9.6 and 3.12.13, each accepted in both positions with the value
* round-tripping — so they are safe raw wherever they reach emitted text
* unescaped, which for all three is `JSON.stringify`, at two call sites:
* {@link pyScalar}'s literal path, and the subscript tool-name comment's own
* call, which a name carrying any of them always reaches, none being
* `XID_Continue`. The `description` path escapes NEL under the class above and
* folds LS and PS in {@link describe}'s `\s+` collapse, both being `\s`.
*/
const UNPRINTABLE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
/**
* Unpaired surrogate code points, escaped by {@link describe} as `\uNNNN` —
* its own form, since `\xNN` stops at U+00FF. The `u` flag is what makes this
* the LONE ones: in Unicode mode a well-formed pair is a single astral code
* point outside D800 to DFFF, so an emoji in a description survives untouched.
*
* This is the NUL case from {@link UNPRINTABLE}, not the invisible-character
* case. Python source must be UTF-8-encodable and a lone surrogate is not, so
* `compile()` raises `UnicodeEncodeError: surrogates not allowed` for one
* anywhere in the text — measured on 3.9 for a string literal and for a `#`
* comment alike. A raw or MCP tool description reaches this: `JSON.parse` on a
* wire `"\ud800"` escape yields exactly such a code point.
*/
const LONE_SURROGATE = /[\ud800-\udfff]/gu;
/**
* The collapsed one-line `description` of a schema node (byte-stable across
* formatting churn), or `undefined` when the node carries none. Every caller
* passes an object — a validated property node, the `ToolSdkSchema` itself, or
* the `{ description }` wrapper {@link docLines} synthesizes — so only the
* description field needs guarding. A description that collapses
* to nothing (empty, or whitespace only) is `undefined` too: it documents the
* node no better than an absent one, and emitting it would leave an empty
* `"""` docstring or a bare `#   ` line in the SDK. Only ECMAScript whitespace
* folds, so a description of whitespace plus one surviving control character is
* NOT absent: it collapses to that character's visible escape.
*
* Control characters left over after the whitespace collapse are rendered as
* their `\xNN` escapes (see {@link UNPRINTABLE}) and unpaired surrogates as
* their `\uNNNN` escapes (see {@link LONE_SURROGATE}); the escape's own backslash is
* emitted literally by both consumers, since {@link docLines} doubles it into a
* Python source escape and a `#` comment carries it verbatim.
*/
function describe(schema) {
	const description = schema.description;
	if (typeof description !== "string") return void 0;
	const collapsed = description.replace(/\s+/g, " ").replace(UNPRINTABLE, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`).replace(LONE_SURROGATE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).trim();
	return collapsed.length === 0 ? void 0 : collapsed;
}
/**
* One-line docstring for a tool `description`, or no lines when there is none.
* Backslashes are doubled first, every quote is escaped, and a trailing
* backslash cannot survive: a description ending in `"` or an odd backslash
* would otherwise merge with (or escape) the closing triple quote and make
* the generated block — PTC mode's only SDK — syntactically invalid Python.
*/
function docLines(description, indent) {
	const collapsed = describe({ description });
	if (collapsed === void 0) return [];
	const escaped = collapsed.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
	return [`${pad(indent)}"""${escaped}"""`];
}
/**
* CamelCase a name into a Python type identifier: non-identifier characters
* split words, `_` splits too (it is `XID_Continue`, so the split set names it
* explicitly), and a head that cannot start an identifier takes a `Tool`
* prefix. Unicode survives, so a `路径` field yields `路径`-based class names
* instead of collapsing to the bare prefix. A character that is not
* `XID_Continue` splits even when it is a letter, so a name whose NFKC folding
* would leave the identifier set is not carried through — the split set is the
* grammar's, not an ASCII approximation of it.
*
* The result is NFKC-normalized: these names are generated, never matched
* against a JSON key, so normalizing is free here and keeps what CPython
* compiles identical to what is emitted — unlike {@link isBareIdentifier},
* which must reject unstable names outright. Normalizing AFTER the prefix
* decision is what makes that hold at the seam the prefix creates: `Tool` +
* a combining-mark head composes there (`U+0301` gives `Tooĺ`, U+013A), so
* normalizing only the un-prefixed part would emit a name CPython compiles to
* a different symbol. The second call is idempotent on the un-prefixed arm.
*
* The split set, the head test, and `toUpperCase()` all read the engine's
* Unicode tables, so this function carries the same version skew
* {@link isBareIdentifier} documents, by paths independent of it: a class name
* derived here reaches emitted text whenever any object shape in the tool's
* schema declares a `TypedDict`, and the predicate's verdict on the tool name
* does not gate that. The case mapping is the one that can fail on a name the
* predicate accepted; the worked example is there.
* @param raw - the schema field or tool name to derive from.
* @returns a class-name segment safe to emit.
*/
function camelCase(raw) {
	const joined = raw.split(/[^\p{XID_Continue}]+|_+/u).filter((part) => part.length > 0).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("").normalize("NFKC");
	return (/^\p{XID_Start}/u.test(joined) ? joined : `Tool${joined}`).normalize("NFKC");
}
/** Class-name base cap keeping each emitted name — and total text — linear in schema depth. */
const MAX_CLASS_NAME_BASE = 120;
/**
* Deepest `list[…]` nesting emitted into one annotation before the item type
* degrades to `Any`. CPython's tokenizer rejects a logical line holding more
* than 200 simultaneously-open brackets (`MAXLEVEL`, `SyntaxError: too many
* nested parentheses`), so an array chain deeper than that would render an SDK
* block that is not valid Python at all — the same failure the docstring
* escaping in {@link docLines} exists to prevent. 180 leaves headroom for the
* few brackets an annotation can add around the chain, all of which count
* toward the same limit. Per emission site, counting brackets open at the
* chain's innermost point:
*
* - Return annotation, `async def f(self, args: X) -> chain:` — 180 `list[`
*   plus an innermost `Literal[`. The parameter list's `(` closed at the `)`
*   before the `->`, so it is NOT open here: 181.
* - TypedDict field, `field: NotRequired[chain]` — a class-body line with no
*   other open bracket, and its children start at `listDepth: 1` to reserve
*   the `NotRequired[`, so 179 `list[` plus `Literal[`: 181. Required fields
*   share that start for uniformity, spending one level of representable depth
*   on a bracket they never emit.
* - Argument annotation, `async def f(self, args: chain) -> Y:` — the `(` IS
*   still open around it: 180 `list[` plus `Literal[` plus the paren, 182, the
*   worst case. Reachable only through a raw `register()` whose `parameters`
*   is an array reached from the root through `oneOf` arms alone — the root
*   array itself, or one nested under any depth of unions, since an arm
*   inherits the enclosing depth unchanged (`A | B` opens no bracket). An
*   object ancestor takes it out of this case: its fields restart the chain at
*   the 181 site. `defineTool` compiles an object root, so the annotation is a
*   bare TypedDict class name or a one-bracket `dict[str, Any]` when that
*   object degrades — never a chain.
*
* A CPython grammar limit, not a deployment choice, so it is fixed rather than
* configurable. The sibling `ts-types` renderer needs no counterpart: nothing
* in the TypeScript grammar bounds nesting, and its SDK block is never type-
* checked. Only bracket nesting counts — a `oneOf` renders as a flat `A | B`
* chain and nested objects render as separate `class` statements, so neither
* accumulates open brackets at any depth. The invariant this cap serves is
* grammatical validity; see the `oneOf` arm in {@link renderType} for the one
* interpreter limit deliberately left uncapped.
*/
const MAX_LIST_NESTING = 180;
/**
* Cap a class-name base at {@link MAX_CLASS_NAME_BASE} (see the callers for
* why capping keeps the render linear). `slice` counts UTF-16 code units, so
* an astral character straddling the boundary would be cut in half and leave a
* lone surrogate — not an identifier character, and not even well-formed text;
* drop it rather than emit it.
*/
function capClassNameBase(base) {
	if (base.length <= MAX_CLASS_NAME_BASE) return base;
	const capped = base.slice(0, MAX_CLASS_NAME_BASE);
	return /[\uD800-\uDBFF]$/.test(capped) ? capped.slice(0, -1) : capped;
}
/**
* Reserve a unique class name from a base, suffixing `2`, `3`, … on collision.
* The base is capped at {@link MAX_CLASS_NAME_BASE} first: child class names
* derive from their parent's allocated name (`ParentChild`), so an unbounded
* schema of single-field objects would otherwise grow each name by one field
* per level and the sum of all names to Θ(depth²). Capping the base keeps each
* name — and the total emitted text — linear in depth. Collisions resume from
* the per-base counter in `state.nextClassCounter` rather than rescanning from
* `2`, so a deep chain sharing one capped base stays O(1) per allocation
* (amortized) instead of Θ(depth²) in time.
*/
function allocateClassName(base, state) {
	const capped = capClassNameBase(base);
	let name = capped;
	if (state.usedClassNames.has(name)) {
		let n = state.nextClassCounter.get(capped) ?? 2;
		while (state.usedClassNames.has(`${capped}${n}`)) n++;
		name = `${capped}${n}`;
		state.nextClassCounter.set(capped, n + 1);
	}
	state.usedClassNames.add(name);
	return name;
}
/**
* Append a child-name segment to a parent class-name base, capping the result
* at {@link MAX_CLASS_NAME_BASE}. Capping AT PROPAGATION (not only inside
* {@link allocateClassName}) keeps each level O(1): a deep `oneOf`- or
* object-chain would otherwise carry an ever-growing ConsString down the tree
* and re-materialize it (via `.length`/`.slice`) at every level — Θ(depth²).
* The bounded base plus the collision counter still yields unique names.
*
* The join is NFKC-normalized because both sides are separately normalized yet
* their concatenation need not be: a base ending in a Hangul L jamo or LV
* syllable composes with a following V or T jamo head (`가` + `ᆨ` gives `각`),
* so the emitted class name would differ from the symbol CPython compiles, and
* two byte-distinct names could fold onto one — `usedClassNames` dedupes by the
* raw bytes, so the collision counter would not see it. Normalizing costs
* O(cap + segment) per level, the same order as the `slice` it feeds. The other
* two join points need no counterpart: `Args`/`Output` start with `A`/`O` and
* {@link allocateClassName}'s suffix is digits, none of which compose backwards.
*/
function childClassName(base, segment) {
	return capClassNameBase(`${base}${segment}`.normalize("NFKC"));
}
/**
* Render one validated scalar as Python literal text (`True`/`False`,
* JSON-quoted strings, bare numbers). `null` cannot reach here: the `null`
* type renders directly as `None`, and the unified validator rejects a null
* `const`/`enum` entry on every other scalar type.
*
* A beyond-safe-range integral number takes `BigInt` digits rather than
* `String`: Python integers are arbitrary-precision, so the emitted digits ARE
* the value the model programs against, and `String` can give a different
* integer than the double holds (`2 ** 60` prints the rounded `...847000`, not
* the exact `...846976`) or no integer literal at all (`1e21` prints `1e+21`).
* `String`'s rounding is not a bug in it: `Number::toString` emits the shortest
* decimal string that re-reads to the same double, then pads to the exponent
* with zeros (1 significant digit for `1e20`, 16 for `2 ** 60`) — and when the
* shortest string is shorter than the double's exact value, those padded digits
* name an integer no double holds. Passing one back would have to cross the
* argument boundary as a JSON number — a double again — so the SDK would
* document a value no program can pass. `BigInt` needs no case split: where
* `String` is already exact (`2 ** 53`, `1e20`) the two agree byte for byte,
* and where it is not, `BigInt` is the exact one. The TS flavor needs no
* counterpart at all: its literal is re-read by a JS parser back into the same
* double.
*
* `JSON.stringify` is also what keeps this path's output parseable, and it is
* the only thing that does. It covers both classes of hazard: the two kinds of
* code point CPython refuses anywhere in source — NUL among the C0 controls,
* and the whole D800–DFFF unpaired-surrogate block, escaped under ES2019
* well-formed stringification, which the engines range guarantees — and the
* ones that break this line in particular, a bare `"` closing the literal
* early, a trailing odd backslash eating the closing quote, and a bare LF/CR
* ending it before its terminator. The `description` path carries
* {@link UNPRINTABLE} and {@link LONE_SURROGATE} because nothing quotes it,
* and folds newlines in {@link describe}.
*
* That leans on a coincidence worth naming: every escape `JSON.stringify` can
* emit (`\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`) is also a Python
* escape denoting the same character, so the emitted `Literal[...]` both
* parses and decodes back to the value the schema declared. DEL, the C1
* controls (NEL among them), and LS/PS (U+2028/U+2029) do reach it raw —
* legal but invisible, byte-for-byte as in the TS flavor; escaping them is a
* both-flavors change. Those last three are legal here for the reason
* {@link UNPRINTABLE} records: they are `str.splitlines()` boundaries, not
* tokenizer line terminators. The subscript tool-name comment quotes its name
* through its own call to the same `JSON.stringify`, never through this
* function, and inherits both halves — escapes and pass-throughs alike.
*/
function pyScalar(value) {
	if (value === true) return "True";
	if (value === false) return "False";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) return BigInt(value).toString();
	return String(value);
}
/**
* Render a validated scalar `const`/`enum` as `Literal[...]`, falling back to
* the broad type. Deliberately deviates from PEP 586, which restricts `Literal`
* parameters to int/bool/str/bytes/enum/None: a non-integral number
* `const`/`enum` emits a float literal (`Literal[1.5]`) a strict checker would
* reject. An integral one does not deviate — {@link pyScalar} emits int digits,
* including for the beyond-safe-range values it widens through `BigInt`, and
* PEP 586 admits int parameters. Harmless either way — the stub is advisory
* prompt text, only required to parse — and keeping the exact value
* communicates the constraint to the model.
*/
function renderConstrainedScalar(node, broad, state) {
	if (node.const !== void 0) {
		state.typing.add("Literal");
		return `Literal[${pyScalar(node.const)}]`;
	}
	if (node.enum !== void 0) {
		state.typing.add("Literal");
		return `Literal[${node.enum.map(pyScalar).join(", ")}]`;
	}
	return broad;
}
/**
* Map one JSON-Schema node to a Python type expression, threading `state` to
* collect the `TypedDict` declarations and `typing` symbols a full render
* needs. `className` is the name to give an object node with properties (and
* the prefix for its nested objects). Handles every unified schema construct —
* `oneOf` (→ `X | Y`), `const`/`enum` (→ `Literal[...]`), `integer` (→ `int`),
* `null` (→ `None`) — and degrades an unsupported or malformed schema to `Any`
* without throwing, the same trusted-after-validation stance as the sibling
* {@link ./ts-types.ts | ts-types} renderer. {@link jsonSchemaToPy} is the
* context-free entry point; this is the collecting core.
*/
function renderType(schema, className, state) {
	const newFrame = (schema, className, listDepth) => ({
		schema,
		className,
		phase: "start",
		listDepth,
		children: [],
		childIndex: 0,
		childTypes: [],
		entries: []
	});
	try {
		assertSupportedJsonSchema(schema);
		const frames = [newFrame(schema, className, 0)];
		let result;
		const finish = (type) => {
			frames.pop();
			const parent = frames.at(-1);
			if (parent === void 0) result = type;
			else parent.childTypes.push(type);
		};
		while (frames.length > 0) {
			const frame = frames.at(-1);
			/* v8 ignore next -- the loop condition guarantees a current frame. */
			if (frame === void 0) break;
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing python render child");
					frame.childIndex++;
					frames.push(newFrame(child.schema, child.className, child.listDepth));
					continue;
				}
				if (frame.kind === "oneOf") {
					let union = "";
					for (const [index, childType] of frame.childTypes.entries()) union = index === 0 ? childType : `${union} | ${childType}`;
					finish(union);
					continue;
				}
				if (frame.kind === "array") {
					/* v8 ignore next -- the ?? arm needs a childless array frame, which start never builds. */
					finish(`list[${frame.childTypes[0] ?? "Any"}]`);
					continue;
				}
				const node = frame.node;
				const name = frame.allocated;
				/* v8 ignore next -- typeddict frames always set node and allocated at start. */
				if (node === void 0 || name === void 0) throw new Error("missing typeddict frame state");
				const required = new Set(node.required);
				const lines = [`class ${name}(TypedDict):`];
				for (let index = 0; index < frame.entries.length; index++) {
					const entry = frame.entries[index];
					const fieldType = frame.childTypes[index];
					/* v8 ignore next -- entries and childTypes correspond one-to-one. */
					if (entry === void 0 || fieldType === void 0) throw new Error("missing typeddict field type");
					const [field, fieldSchema] = entry;
					const description = describe(fieldSchema);
					if (description !== void 0) lines.push(`${pad(1)}# ${description}`);
					if (required.has(field)) lines.push(`${pad(1)}${field}: ${fieldType}`);
					else {
						state.typing.add("NotRequired");
						lines.push(`${pad(1)}${field}: NotRequired[${fieldType}]`);
					}
				}
				if (node.additionalProperties !== false) lines.push(`${pad(1)}# Additional keys beyond those declared are allowed.`);
				if (lines.length === 1) lines.push(`${pad(1)}pass`);
				state.classes.push(lines.join("\n"));
				finish(name);
				continue;
			}
			frame.phase = "children";
			const node = frame.schema;
			if (node.oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = node.oneOf.map((branch, index) => ({
					schema: branch,
					className: childClassName(frame.className, `${index + 1}`),
					listDepth: frame.listDepth
				}));
				continue;
			}
			if (node.type === void 0) {
				state.typing.add("Any");
				finish("Any");
				continue;
			}
			switch (node.type) {
				case "string":
					finish(renderConstrainedScalar(node, "str", state));
					break;
				case "number":
					finish(renderConstrainedScalar(node, "float", state));
					break;
				case "integer":
					finish(renderConstrainedScalar(node, "int", state));
					break;
				case "boolean":
					finish(renderConstrainedScalar(node, "bool", state));
					break;
				case "null":
					finish("None");
					break;
				case "array":
					if (node.items === void 0) {
						state.typing.add("Any");
						finish("list[Any]");
						break;
					}
					if (frame.listDepth >= MAX_LIST_NESTING) {
						state.typing.add("Any");
						finish("Any");
						break;
					}
					frame.kind = "array";
					frame.children = [{
						schema: node.items,
						className: frame.className,
						listDepth: frame.listDepth + 1
					}];
					break;
				case "object": {
					const entries = Object.entries(node.properties ?? {});
					if (className === "" || !entries.every(([name]) => isBareIdentifier(name) && !RESERVED.has(name) && !(name.startsWith("__") && !name.endsWith("__")))) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					if (entries.length === 0 && node.additionalProperties !== false) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					frame.kind = "typeddict";
					frame.node = node;
					frame.allocated = allocateClassName(frame.className, state);
					state.typing.add("TypedDict");
					frame.entries = entries;
					/* v8 ignore next -- allocated is always set before children are built. */
					frame.children = entries.map(([field, child]) => ({
						schema: child,
						className: childClassName(frame.allocated ?? "", camelCase(field)),
						listDepth: 1
					}));
					break;
				}
				/* v8 ignore next 4 -- assertSupportedJsonSchema narrowed this closed type union. */
				default:
					state.typing.add("Any");
					finish("Any");
			}
		}
		/* v8 ignore next -- every root frame produces one expression. */
		return result ?? "Any";
	} catch {
		state.typing.add("Any");
		return "Any";
	}
}
/** The fixed model-facing usage contract rendered above the declarations. */
const SDK_INSTRUCTIONS = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async Python function (top-level \`await\` and \`return\` both work) — and \`description\`, a short summary of what the program does. At run time exactly two of the names declared below are bound: \`tools\` and \`ToolCallError\`. Everything else is a STATIC STUB describing argument and return types — in particular the \`TypedDict\` classes do NOT exist at run time, so build arguments as plain \`dict\`/\`list\` JSON values: \`await tools.name({"field": 1})\`, never \`FooArgs(field=1)\`, which raises \`NameError\`. Inside the program:

- Call tools as \`await tools.name(args)\` — subscript access for exotic, reserved, or underscore-leading names: \`await tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value (each method's return type below). Tool arguments must be lossless JSON.
- A FAILED tool call raises \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose message is human-readable — wrap in \`try/except\` to handle and continue.
- Independent read-only calls MAY overlap under \`asyncio.gather\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit the run's answer with \`print(...)\` and/or a top-level \`return <value>\`; the returned value must be lossless JSON. Only what you print and return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

The available tools:`;
/**
* Render the full `tools:sdk` prompt section under `runtime.language ===
* 'python'`: the Python-flavored usage instructions plus one named `TypedDict`
* per tool argument or output object (and per nested object) and one awaitable
* method per visible tool on a `Tools` protocol — typed args in, the tool's
* canonical output value out — with a `tools: Tools` singleton the model calls
* into. The `typing` import line lists exactly the symbols the render used.
* Deterministic — tools are emitted in lexicographic name order, and class
* declarations precede the protocol in that same order (nested classes before
* the parent that references them), so an unchanged tool set produces
* byte-identical text across assemblies. The sort is not a total order on
* byte-equal names, so two schemas sharing a name would render in argument
* order; the caller's visible-capability map is keyed by name, so the input
* never carries a duplicate.
* @param schemas - the tool schemas plus canonical output schemas to declare
*   (the caller excludes `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdkPy(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const state = {
		classes: [],
		usedClassNames: /* @__PURE__ */ new Set(),
		nextClassCounter: /* @__PURE__ */ new Map(),
		typing: new Set(["Protocol"])
	};
	const members = [];
	let statements = 0;
	for (const schema of sorted) {
		const argType = renderType(schema.parameters, `${camelCase(schema.name)}Args`, state);
		const outputType = renderType(schema.output, `${camelCase(schema.name)}Output`, state);
		if (isBareIdentifier(schema.name) && !RESERVED.has(schema.name) && !schema.name.startsWith("_")) {
			const doc = docLines(schema.description, 2);
			members.push(doc.length > 0 ? `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}:` : `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}: ...`);
			members.push(...doc);
			statements += 1;
		} else {
			members.push(`${pad(1)}# tools[${JSON.stringify(schema.name)}](args: ${argType}) -> ${outputType}`);
			const description = describe(schema);
			if (description !== void 0) members.push(`${pad(1)}#   ${description}`);
		}
	}
	const body = (statements > 0 ? members : [`${pad(1)}pass`, ...members]).join("\n");
	const imports = TYPING_ORDER.filter((symbol) => state.typing.has(symbol));
	const classBlock = state.classes.length > 0 ? `${state.classes.join("\n\n")}\n\n` : "";
	return `${SDK_INSTRUCTIONS}\n\n\`\`\`python\n${`from typing import ${imports.join(", ")}\n\nclass ToolCallError(Exception):
    toolName: str\n\n${classBlock}class Tools(Protocol):\n${body}\n\ntools: Tools`}\n\`\`\``;
}
/**
* Tool registry, model presentation modes, and pre/guard/around/post/result
* execution pipeline.
* @module @deepseek-ai/dsh-tools
*/
/**
* Language → SDK-section renderer. The registry looks up the loaded
* `ctx.ptcRuntime.language` in this table when assembling the `tools:sdk`
* section under a non-native mode; a runtime whose language is not a key
* fails the assembly loudly (same idiom as `toolOrder` violations). Adding a
* new backend language is three parallel edits — a {@link PtcSdkLanguage}
* member, an entry here, and a `RUN_CODE_FLAVORS` entry in `ptc.ts` for
* its `run_code` schema strings — plus the renderer function this table points
* at. The `satisfies` clause pins this table's key set to that union, which
* the flavor table is checked against too, so any of the three left out is a
* typecheck failure. What no check reaches is the prose that names the values
* instead of deriving them: the seam's `dsh-ptc-runtime` README pair, its
* `PtcRuntime.language` JSDoc, and `docs/subsystems/ptc-runtime.md`
* with its zh pair, plus this package's own README pair and the
* {@link Config.mode} JSDoc.
*/
/**
* The model-facing statement of the `ptc` collapse. Names the consequence
* (the call fails) and the route (inside the program), because a rule the
* model can only discover by being denied is one it corrects too late.
*/
const PTC_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.`;
const SDK_RENDERERS = {
	typescript: renderToolsSdk,
	python: renderToolsSdkPy
};
/**
* Scheduler entry point omitted from the generated named service API.
* @internal
*/
const TOOL_RUNTIME_SCHEDULER = Symbol("@deepseek-ai/dsh-tools.scheduler");
/** Canonical error code for cancellation after a tool body was invoked. */
const TOOL_ABORTED = "ABORTED";
/** Canonical error code for cancellation before a tool body was invoked. */
const TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";
/**
* Thrown (internally) when the model requests a tool that isn't registered.
* Extends {@link HarnessError} (`code: 'UNKNOWN_TOOL'`) so an unknown-tool
* failure is as routable as a tool-thrown one — retry/sandbox/replay code can
* distinguish it from a tool body's own error.
*/
var ToolNotFoundError = class extends HarnessError {
	/**
	* @param toolName - the name the caller asked for.
	* @param reachableFrom - how the model reaches this tool instead, when the
	*   name IS visible and only the presentation denies calling it directly.
	*   Omitted for a name that is registered nowhere.
	*/
	constructor(toolName, reachableFrom) {
		super(reachableFrom === void 0 ? `unknown tool "${toolName}"` : `unknown tool "${toolName}": ${reachableFrom}`, "UNKNOWN_TOOL");
		this.name = "ToolNotFoundError";
	}
};
/** Thrown when a tool body or post-policy value violates its declared output. */
var ToolOutputError = class extends HarnessError {
	/** Schema/value violations in validation order. */
	violations;
	constructor(toolName, violations) {
		super(`tool "${toolName}" returned invalid output: ${violations.join("; ")}`, "INVALID_TOOL_OUTPUT");
		this.name = "ToolOutputError";
		this.violations = violations;
	}
};
/** Convert one projector exception into the canonical invalid-output failure. */
function projectionError(toolName, projector, error) {
	return new ToolOutputError(toolName, [`output.${projector} failed: ${errorMessage(error)}`]);
}
/** Snapshot one projector result before later durable-result materialization. */
function snapshotProjection(toolName, projector, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, [`output.${projector} returned non-lossless JSON`]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw projectionError(toolName, projector, error);
	}
}
/** Snapshot one body or policy value into the canonical invalid-output failure class. */
function snapshotToolValue(toolName, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, ["value is not lossless JSON"]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw new ToolOutputError(toolName, [`value snapshot failed: ${errorMessage(error)}`]);
	}
}
/**
* Best-effort human-readable message from an arbitrary thrown value: Error
* instances use `.message`; non-Error objects with a string `message`
* property (e.g. `throw { message: 'denied' }`) use it too; everything else
* is stringified.
*/
function errorMessage(error) {
	try {
		if (error instanceof Error) return error.message;
		if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
		return String(error);
	} catch {
		return "<unprintable thrown value>";
	}
}
/** Derive one failure message from policy feedback without changing its rendered blocks. */
function failureMessageFromContent(content) {
	const text = content.map((block) => block.type === "text" ? block.text : `[${block.type} content]`).join("\n");
	return text.length > 0 ? text : "tool result blocked by post-execute policy";
}
/** Snapshot and freeze one durable tool-result projection or reject lossy data. */
function materializePresentation(candidate) {
	const detached = snapshotJsonValue(candidate);
	if (detached === void 0) throw new TypeError("tool result must be losslessly JSON-serializable");
	return deepFreeze(detached);
}
/** Structured `{ name, code }` for a thrown HarnessError, else undefined. */
function errorInfo(error) {
	try {
		return error instanceof HarnessError ? {
			name: error.name,
			code: error.code
		} : void 0;
	} catch {
		return;
	}
}
/** One scope's complete tool-registry contribution. */
var ToolLayer = class {
	tools;
	restrictions = new AnonymousEntries();
	guards = new AnonymousEntries();
	/**
	* Presentation this scope's agent declared for itself, shadowing the
	* deployment default. One cell rather than an entry table: two answers to
	* "which form does the model see" is a contradiction, not a merge.
	*/
	mode;
	constructor(scope) {
		this.tools = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `tool "${name}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)` : `tool "${name}" is already registered in this scope`));
	}
	/** Whether every contribution table in this aggregate layer is empty. */
	isEmpty() {
		return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty() && this.mode === void 0;
	}
	/** Whether every compiled restriction in this layer admits a global tool name. */
	admits(name) {
		for (const filter of this.restrictions.values()) if (filter.allow !== void 0 && !filter.allow.has(name) || filter.deny !== void 0 && filter.deny.has(name)) return false;
		return true;
	}
	/** First monotonic denial from this layer's live guard registrations. */
	guardReason(exec) {
		for (const guard of this.guards.values()) {
			const reason = guard(exec);
			if (reason !== void 0) return reason;
		}
	}
};
/** Resolve the run_code overlap cap at the owning config boundary (direct construction bypasses the Loader schema). */
function resolveMaxParallelSubCalls(value) {
	const maxParallelSubCalls = value ?? 10;
	if (!Number.isInteger(maxParallelSubCalls) || maxParallelSubCalls < 1) throw new Error("maxParallelSubCalls must be a positive integer");
	return maxParallelSubCalls;
}
(class extends Service {
	static inject = ["systemPrompt"];
	static Config = ConfigSchema.object({
		mode: ConfigSchema.union([
			"native",
			"ptc",
			"both"
		]).default("native"),
		maxParallelSubCalls: ConfigSchema.natural().min(1).default(10)
	});
	/** Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler. */
	[TOOL_RUNTIME_SCHEDULER] = {
		prepare: (exec) => this.prepareScheduledExecution(exec),
		dispatch: (exec) => this.dispatchScheduledExecution(exec),
		finalize: (exec, result) => this.finalizeScheduledExecution(exec, result),
		finish: (exec, result) => this.finishScheduledExecution(exec, result)
	};
	/** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
	deferredContexts = /* @__PURE__ */ new WeakMap();
	/** Executions whose tool body declared the current turn complete. */
	concludingExecutions = /* @__PURE__ */ new WeakSet();
	/** Original caller cancellation, kept outside the wrapper-mutable execution object. */
	cancellationStates = /* @__PURE__ */ new WeakMap();
	/** Definition-owned final content transform snapshotted before policy begins. */
	contentFinalizers = /* @__PURE__ */ new WeakMap();
	layers = new ScopedLayers((scope) => new ToolLayer(scope), () => {
		this.ctx.emit("tools/change");
	});
	/** Presentation for scopes that declare none; {@link presentAs} shadows it per scope. */
	defaultMode;
	maxParallelSubCalls;
	/**
	* Reserved presentation transport, kept outside the filterable registration
	* layers. Built on first need rather than at construction: which agents run
	* a PTC mode is no longer known when the service is constructed, and the
	* transport is stateless beyond its closures over `this`.
	*/
	ptcTransport;
	constructor(ctx, config = {}) {
		super(ctx, "tools");
		this.defaultMode = config.mode ?? "native";
		this.maxParallelSubCalls = resolveMaxParallelSubCalls(config.maxParallelSubCalls);
		ctx.systemPrompt.tools((context) => this.wireSchemas(context.scope));
		if (this.defaultMode !== "native") {
			ctx.systemPrompt.section(this.collapseSection());
			ctx.systemPrompt.section(this.sdkSection());
		}
	}
	/**
	* The prompt statement of the `ptc` executor collapse, registered wherever
	* {@link sdkSection} is and rendering empty outside an effective `ptc`.
	*
	* Every tool contributes its own guidance section naming its tool, none of
	* them qualify how that tool is reached, and they all render before the SDK.
	* Without this the model reads a catalog of tools it is told to use and no
	* statement that only `run_code` may be called, so it emits a native call,
	* receives `UNKNOWN_TOOL` for a tool the prompt just declared, and concludes
	* the deployment is inconsistent. Its order places the rule before that
	* guidance rather than after it.
	*
	* `both` renders empty: native calls do execute there, so the rule is false.
	* @returns the section registration.
	*/
	collapseSection() {
		return {
			name: "tools:ptc-only",
			order: this.ctx.systemPrompt.getSectionOrder("PTC_ONLY"),
			text: (context) => this.modeFor(context.scope) === "ptc" ? PTC_ONLY_INSTRUCTION : ""
		};
	}
	/**
	* The generated-SDK prompt section, registered globally by a PTC mode
	* deployment and per scope by {@link presentAs}.
	*
	* The body regenerates from the CALLING scope, and renders empty for an
	* agent presenting natively — an agent that opted out under a PTC mode
	* deployment still sees the global registration, and an empty section is
	* dropped from the rendered prompt.
	* @returns the section registration.
	*/
	sdkSection() {
		return {
			name: "tools:sdk",
			order: this.ctx.systemPrompt.getSectionOrder("TOOLS_SDK"),
			interpolate: false,
			text: (context) => {
				const mode = this.modeFor(context.scope);
				if (mode === "native") return "";
				const runtime = this.requirePtcRuntime(mode);
				const render = SDK_RENDERERS[runtime.language];
				/* v8 ignore next -- requirePtcRuntime rejects an unknown language before this runs. */
				if (render === void 0) throw new Error(`dsh-tools: no SDK renderer for ${runtime.language}`);
				return render(this.sdkSchemas(context.scope));
			}
		};
	}
	/**
	* The presentation one scope's agent sees: its own declaration, else the
	* deployment default.
	* @param scope - the calling agent, or undefined for the global view.
	* @returns the resolved presentation mode.
	*/
	modeFor(scope) {
		const layers = this.layers.chainLayers(scope);
		for (let index = layers.length - 1; index >= 0; index -= 1) {
			const mode = layers[index]?.mode;
			if (mode !== void 0) return mode;
		}
		return this.defaultMode;
	}
	/**
	* The reserved `run_code` transport, built on first need.
	*
	* It never enters the global layer: per-agent restrictions must not remove
	* it, and a scoped registration must not shadow it. The visibility resolver
	* appends it after resolving the filterable global/scoped capability layers,
	* and only for scopes whose mode actually presents it.
	* @returns the shared transport definition.
	*/
	requirePtcTransport() {
		this.ptcTransport ??= createRunCodeTool(this, {
			requireRuntime: () => this.requirePtcRuntime(this.defaultMode),
			peekApprover: () => this.ctx.get("approval"),
			resolveSandboxPolicy: (exec) => {
				const policy = this.ctx.get("sandboxPolicy");
				if (policy === void 0) throw new Error("dsh-tools: confined PTC runtime requires sandboxPolicy");
				return policy.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session });
			},
			peekRuntime: () => this.ctx.get("ptcRuntime"),
			maxParallel: this.maxParallelSubCalls,
			shapeDispatchLog: (dispatch) => this.shapeDispatchLog(dispatch)
		});
		return this.ptcTransport;
	}
	/**
	* Present the calling scope's tools in `mode` instead of the deployment
	* default. Nearest scope on the chain wins, so a preset's standing
	* declaration covers every agent joined under it.
	*
	* Scoped only, and one declaration per scope: this is how an agent preset
	* composes PTC mode agents beside native ones in the same process, and a
	* process-global override would be the `mode` config field instead.
	* @param mode - the presentation the covered agents' models see.
	* @returns the exact disposer that restores the deployment default.
	*/
	presentAs(mode) {
		const ctx = this.ctx;
		if (scopeOf(ctx) === void 0) throw new Error("tools.presentAs() requires a scoped context (agent.ctx): a context-global presentation is the `mode` config field on the tools row");
		return ctx.effect(function* () {
			yield this.layers.effect(ctx, (layer) => {
				if (layer.mode !== void 0) throw new Error(`tools.presentAs("${mode}") conflicts with "${layer.mode}" already declared for this scope; one composition selects one presentation`);
				layer.mode = mode;
				return () => {
					layer.mode = void 0;
				};
			}, { label: "tools.presentAs()" });
			if (mode !== "native") {
				yield ctx.systemPrompt.section(this.collapseSection());
				yield ctx.systemPrompt.section(this.sdkSection());
			}
		}.bind(this), "tools.presentAs()");
	}
	/**
	* Build one scope's wire schemas and names for prompt-order validation.
	* Restrictions do not make known tools invalid, but a mode collapse does.
	*/
	wireSchemas(scope) {
		const view = this.view(scope);
		const mode = this.modeFor(scope);
		if (mode === "native") return {
			schemas: [...view.visible.values()].map((definition) => this.schemaOf(definition, false)),
			knownNames: [...view.knownNames]
		};
		this.requirePtcRuntime(mode);
		const schemas = [...view.visible.values()].map((definition) => this.schemaOf(definition, false));
		if (mode === "ptc") return {
			schemas: schemas.filter((schema) => schema.name === RUN_CODE_NAME),
			knownNames: [RUN_CODE_NAME]
		};
		return {
			schemas,
			knownNames: [...view.knownNames, RUN_CODE_NAME]
		};
	}
	/**
	* Resolve the PTC runtime or throw the actionable misconfiguration error.
	* Read at use time (assembly / run_code execution), NOT via static
	* `inject`: an inject entry would hold `ctx.tools` — and every tool plugin
	* behind it — hostage to a PTC runtime existing even under `mode:
	* 'native'`.
	*
	* Assembly and `run_code` execution read separately, so the language is not
	* bound to a request. Harmless while one published backend exists — both
	* reads return the same flavor — but a reload that swapped in a second
	* language between them would hand a program written against one SDK to the
	* other. Binding it is deferred until a second backend ships (the first
	* point it is testable).
	*/
	requirePtcRuntime(mode) {
		const runtime = this.ctx.get("ptcRuntime");
		if (!runtime) throw new Error(`dsh-tools: mode "${mode}" requires a PTC runtime — load a ctx.ptcRuntime implementation (e.g. @deepseek-ai/dsh-ptc-runtime-node) or set tools mode to "native"`);
		if (!Object.hasOwn(SDK_RENDERERS, runtime.language)) {
			const known = Object.keys(SDK_RENDERERS).map((name) => JSON.stringify(name)).join(", ");
			throw new Error(`dsh-tools: no SDK renderer registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
		}
		return runtime;
	}
	/**
	* Register globally or in the calling agent scope. Scoped tools shadow
	* globals; duplicates within one layer and the reserved `run_code` name fail.
	* @param definition - tool schema, execution, and optional finalization/presentation callbacks.
	* @returns the exact disposer that unregisters the tool.
	*/
	register(definition) {
		const name = definition.name;
		const output = definition.output;
		if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || output.presentationMeta !== void 0 && typeof output.presentationMeta !== "function") throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
		assertSupportedJsonSchema(output.schema);
		const timeoutMs = definition.timeoutMs;
		if (timeoutMs !== void 0 && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`);
		if (name === "run_code") throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`);
		return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), { label: "tools.register()" });
	}
	/**
	* Restrict global tools for the calling agent scope. Empty filters, unknown
	* names, scope-local names, and reserved transport names fail. Restrictions
	* intersect; scoped registrations remain visible.
	* @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
	* @returns the exact disposer that lifts this restriction.
	*/
	restrict(filter) {
		const scope = scopeOf(this.ctx);
		if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");
		const allow = filter.allow;
		const deny = filter.deny;
		if (allow === void 0 && deny === void 0) throw new Error("tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)");
		const compiled = {
			...allow !== void 0 ? { allow: new Set(allow) } : {},
			...deny !== void 0 ? { deny: new Set(deny) } : {}
		};
		if ([...allow ?? [], ...deny ?? []].includes("run_code")) throw new Error(`tools.restrict() cannot name reserved PTC mode presentation transport "${RUN_CODE_NAME}"; restrict end-capability tools instead`);
		const known = this.view(scope).restrictableNames;
		const unknown = [...allow ?? [], ...deny ?? []].filter((name) => !known.has(name));
		if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ") || "(none)"}`);
		return this.layers.effect(this.ctx, (layer) => layer.restrictions.append(compiled), { label: "tools.restrict()" });
	}
	/**
	* Register a monotonic guard after the extensible `tools/pre-execute`
	* waterfall. A plain-context guard applies globally; one registered through
	* `agent.ctx` applies only to that agent. Any matching guard may deny by
	* returning a reason, while no guard can force-allow a call another guard
	* denied. The exact effect disposer is returned for ordered ownership and
	* HMR cleanup.
	* @param guard - synchronous check; a returned string denies the execution.
	* @returns the exact disposer that unregisters the guard.
	*/
	guard(guard) {
		return this.layers.effect(this.ctx, (layer) => layer.guards.append(guard), {
			label: "tools.guard()",
			notify: false
		});
	}
	/** First monotonic denial from the global then the scope chain's guard layers, farthest first. */
	guardReason(exec) {
		const globalReason = this.layers.global.guardReason(exec);
		if (globalReason !== void 0) return globalReason;
		if (exec.agent === void 0) return void 0;
		for (const layer of this.layers.chainLayers(exec.agent)) {
			const reason = layer.guardReason(exec);
			if (reason !== void 0) return reason;
		}
	}
	/**
	* Resolve every registry fact one scope needs in one layer traversal. The
	* visible map applies restrictions to the INHERITED surface, then the
	* scope's own registrations and the reserved presentation transport; the
	* other sets retain the pre-restriction facts needed by restriction and
	* prompt-order validation.
	*
	* A restriction filters what a scope inherits — the global layer and every
	* ancestor layer on its chain — and never what its OWN layer registers.
	* That exemption is what a per-child capability filter has to keep intact:
	* the delegation runtime registers a child's structured-output tool into the
	* child's own layer, and a filter naming the capabilities the child may use
	* must not strip the machinery it answers through.
	*
	* Reading the exempt set as "the global layer" instead of "not mine" held
	* only while every model-facing tool sat in the host composition. Once
	* presets moved them onto the agent plane they became an ANCESTOR
	* contribution, so a child's filter silently stopped constraining anything
	* it was given.
	* @param scope - the viewing scope (the agent), or undefined for the global view.
	* @returns the complete derived view for that scope.
	*/
	view(scope) {
		const layers = this.layers.chainLayers(scope);
		const own = this.layers.peek(scope);
		const inherited = new Map(this.layers.global.tools.entries());
		for (const layer of layers) {
			if (layer === own) continue;
			for (const [name, definition] of layer.tools.entries()) inherited.set(name, definition);
		}
		const visible = /* @__PURE__ */ new Map();
		const knownNames = /* @__PURE__ */ new Set();
		const restrictableNames = /* @__PURE__ */ new Set();
		for (const [name, definition] of inherited) {
			knownNames.add(name);
			restrictableNames.add(name);
			if (layers.every((layer) => layer.admits(name))) visible.set(name, definition);
		}
		if (own !== void 0) for (const [name, definition] of own.tools.entries()) {
			knownNames.add(name);
			visible.set(name, definition);
		}
		if (this.modeFor(scope) !== "native") visible.set(RUN_CODE_NAME, this.requirePtcTransport());
		return {
			visible,
			knownNames,
			restrictableNames
		};
	}
	/**
	* Look up a tool as one scope sees it (scoped
	* shadows global; a restricted-away global reads as absent). Presenters pass
	* the calling agent so the rendered card matches the definition that
	* actually executed.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns the definition the scope resolves, or undefined when none is visible.
	*/
	get(name, scope) {
		return this.view(scope).visible.get(name);
	}
	/**
	* Resolve the definition that MAY EXECUTE for a call, applying the mode
	* collapse at the operation boundary that owns it. The registry view
	* (`get`) is presentation-agnostic; here a MODEL-DIRECT call under `ptc`
	* may only name the reserved `run_code` transport, while a nested
	* sub-dispatch (a `parent` token set — the `run_code` SDK calling a tool
	* it bound) may call any visible tool. Denial surfaces as `UNKNOWN_TOOL`
	* through the executor, matching an absent definition.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	* @returns the definition that may run, or undefined when the call must be rejected.
	*/
	resolveExecution(name, scope, nested) {
		const tool = this.get(name, scope);
		if (tool === void 0) return void 0;
		if (this.collapses(name, scope, nested)) return void 0;
		return tool;
	}
	/**
	* Project visible definitions onto the allowlisted model-facing schema fields,
	* excluding execution and presentation callbacks.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns one deep-cloned schema per visible tool.
	*/
	schemas(scope) {
		return [...this.view(scope).visible.values()].map((definition) => this.schemaOf(definition, true));
	}
	/** Project visible callable tools onto the generated PTC mode SDK contract. */
	sdkSchemas(scope) {
		return [...this.view(scope).visible.values()].filter((definition) => definition.name !== RUN_CODE_NAME).map((definition) => {
			const output = snapshotJsonValue(definition.output.schema);
			/* v8 ignore next -- registration already validated and retained this schema as lossless JSON. */
			if (output === void 0) throw new Error(`tool "${definition.name}" output schema must be lossless JSON before SDK projection`);
			return {
				...this.schemaOf(definition, true),
				output
			};
		});
	}
	/** Project one definition onto the model-facing schema fields. */
	schemaOf(definition, detachParameters) {
		const { name, description, parameters, deferLoading } = definition;
		const detached = detachParameters ? snapshotJsonValue(parameters) : parameters;
		if (detached === void 0) throw new Error(`tool "${name}" parameters must be lossless JSON before schema projection`);
		return {
			name,
			description,
			parameters: detached,
			...deferLoading === true ? { deferLoading } : {}
		};
	}
	/**
	* Classify a pending call through the caller's visible tool definition. Only
	* an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
	* throwing classifiers are exclusive.
	* @param exec - call name, parsed arguments, and optional agent scope.
	* @returns the fail-closed scheduling mode.
	*/
	executionMode(exec) {
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (!tool?.isConcurrencySafe) return { kind: "exclusive" };
		try {
			return tool.isConcurrencySafe(exec.arguments) === true ? { kind: "parallel" } : { kind: "exclusive" };
		} catch {
			return { kind: "exclusive" };
		}
	}
	/**
	* Run the `tools/ptc-dispatch-log` waterfall over one settled sub-dispatch
	* and return the content the bridge should log on `tool/ptc-dispatch`.
	* Contained: when a listener throws, the method logs the original settled
	* content; that failure must not fail the dispatch or omit the settle event. Private:
	* the ONE consumer is the `run_code` bridge this registry constructs, which
	* receives it as a capability parameter (the `requireRuntime` idiom) — the
	* waterfall, not this invoker, is the public extension point.
	*/
	async shapeDispatchLog(dispatch) {
		try {
			return await this.ctx.waterfall(scopeTarget(this, dispatch.agent), "tools/ptc-dispatch-log", dispatch, () => Promise.resolve(dispatch.content));
		} catch (error) {
			this.ctx.logger.warn(`tools: ptc-dispatch-log listener failed for ${dispatch.name}: ${errorMessage(error)}; logging the original settled content`);
			return dispatch.content;
		}
	}
	/**
	* Whether the `ptc` mode collapse denies a model-direct call: only the
	* reserved `run_code` transport may be named. Nested sub-dispatches (a
	* `parent` token set) bypass the collapse. One home for the
	* security-relevant predicate, shared by {@link resolveExecution} and
	* {@link createExecution} so the two can never drift apart.
	*
	* Resolved through {@link modeFor}, NOT `defaultMode`: an agent given `ptc`
	* by an agent preset under a native deployment is the composition
	* `dsh-agent-tool-presentation` exists for, and reading the deployment default would
	* leave exactly that agent uncollapsed — announcing one surface while
	* executing another, which is the bypass this collapse closes.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope whose effective presentation mode applies.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	*/
	collapses(name, scope, nested) {
		return !nested && this.modeFor(scope) === "ptc" && name !== "run_code";
	}
	/**
	* Execute through pre-policy, guards, around-dispatch, post-policy,
	* definition-owned content finalization, and final notification. Tool and
	* listener failures resolve as materialized error results; an invisible tool
	* reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
	* snapshot final observers receive. Cancellation
	* arriving after entry and before final result materialization skips a
	* not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
	* successful started outcome with `ABORTED`; already-started work is still
	* drained and may retain a tool-owned structured error.
	* @param exec - the typed same-process call input. The registry assigns its
	*   correlation token before policy begins.
	* @returns the materialized final result.
	*/
	async execute(exec) {
		return this.prepareExecution(exec, (prepared) => this.completeScheduledExecution(prepared));
	}
	async completeScheduledExecution(prepared) {
		switch (prepared.kind) {
			case "dispatch": {
				const dispatched = await this.dispatchScheduledExecution(prepared.exec);
				return dispatched.kind === "post-result" ? await this.finalizeScheduledExecution(prepared.exec, dispatched.result) : this.finishScheduledExecution(prepared.exec, dispatched.result);
			}
			case "post-result": return await this.finalizeScheduledExecution(prepared.exec, prepared.result);
			case "final-result": return this.finishScheduledExecution(prepared.exec, prepared.result);
			/* v8 ignore next -- closed-union exhaustiveness guard */
			default: return assertNever(prepared, "scheduled tool preparation");
		}
	}
	createExecution(exec) {
		const deferredContexts = [];
		const token = createExecutionToken();
		const callId = exec.callId;
		const rootCallId = exec.rootCallId ?? callId;
		const name = exec.name;
		const agent = exec.agent;
		const parent = exec.parent;
		const signal = exec.signal;
		const visible = this.get(name, agent);
		const collapsed = visible !== void 0 && this.collapses(name, agent, parent !== void 0);
		const concludingExecutions = this.concludingExecutions;
		const base = {
			token,
			callId,
			rootCallId,
			name,
			signal,
			...agent !== void 0 ? { agent } : {},
			...parent !== void 0 ? { parent } : {},
			...exec.schema !== void 0 ? { schema: exec.schema } : {},
			deferContext(context) {
				deferredContexts.push(context);
			},
			concludeTurn() {
				concludingExecutions.add(this);
			}
		};
		const capturedFinalizer = visible?.finalizeContent?.bind(visible);
		const finalizerFor = () => collapsed && !signal.aborted ? void 0 : capturedFinalizer;
		try {
			const detached = snapshotJsonValue(exec.arguments);
			if (detached === void 0) throw new TypeError("tool execution arguments must be losslessly JSON-serializable");
			const execution = {
				...base,
				arguments: deepFreeze(detached)
			};
			this.deferredContexts.set(execution, deferredContexts);
			this.contentFinalizers.set(execution, finalizerFor());
			this.cancellationStates.set(execution, {
				callerSignal: signal,
				bodyInvoked: false
			});
			if (collapsed) {
				if (signal.aborted) return {
					kind: "final-result",
					exec: execution,
					result: toolAbortedBeforeDispatchResult()
				};
				return {
					kind: "final-result",
					exec: execution,
					result: toolErrorResult(new ToolNotFoundError(name, `only \`${RUN_CODE_NAME}\` is callable directly — call \`${name}\` from inside a \`${RUN_CODE_NAME}\` program instead`))
				};
			}
			return {
				kind: "ready",
				exec: execution
			};
		} catch (error) {
			const execution = {
				...base,
				arguments: void 0
			};
			this.contentFinalizers.set(execution, finalizerFor());
			return {
				kind: "final-result",
				exec: execution,
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run the ordered pre-execute and monotonic guard stages for the scheduler.
	* @param input - the caller-supplied execution input.
	* @returns the prepared execution plus the next scheduler stage.
	* @internal
	*/
	async prepareScheduledExecution(input) {
		return this.prepareExecution(input, (prepared) => prepared);
	}
	async prepareExecution(input, next) {
		const created = this.createExecution(input);
		if (created.kind !== "ready") return next(created);
		const exec = created.exec;
		if (this.callerCancelled(exec)) return next({
			kind: "final-result",
			exec,
			result: toolAbortedBeforeDispatchResult()
		});
		try {
			const carrier = scopeTarget(this, exec.agent);
			const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));
			const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : {
				decision: gate,
				approvalCancelled: false
			};
			const { decision } = askResolution;
			if (this.callerCancelled(exec) && askResolution.approvalCancelled) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			if (decision.kind === "cancel") return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			const denialReason = decision.kind === "allow" ? this.guardReason(exec) : decision.reason;
			const denialInfo = decision.kind === "deny" ? decision.info : void 0;
			if (denialReason !== void 0) return await next({
				kind: "post-result",
				exec,
				result: this.materializeFinalResult({
					content: [{
						type: "text",
						text: `Error: ${denialReason}`
					}],
					isError: true,
					error: {
						message: denialReason,
						...denialInfo === void 0 ? {} : { info: denialInfo }
					}
				})
			});
			if (this.callerCancelled(exec)) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			return await next({
				kind: "dispatch",
				exec
			});
		} catch (error) {
			return next({
				kind: "final-result",
				exec,
				result: toolErrorResult(error)
			});
		}
	}
	/** Whether the original caller signal is currently aborted. */
	callerCancelled(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.callerSignal.aborted;
	}
	/** Canonical cancellation outcome selected by whether the tool body started. */
	cancellationResult(exec, prior) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.bodyInvoked ? toolAbortedResult(prior) : toolAbortedBeforeDispatchResult(prior);
	}
	/**
	* Dispatch the registered body with the original caller signal fused back
	* into any around-wrapper replacement. Cancellation never abandons the body:
	* a started promise reaches quiescence before its outcome becomes `ABORTED`.
	*/
	async dispatchToolBody(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		const wrapperSignal = exec.signal;
		const fused = fuseToolSignals(state.callerSignal, wrapperSignal);
		const signal = fused.signal;
		if (isAborted(signal)) {
			fused.dispose();
			return toolAbortedBeforeDispatchResult();
		}
		exec.signal = signal;
		try {
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (!tool) throw new ToolNotFoundError(exec.name);
			state.bodyInvoked = true;
			const returned = await tool.execute(exec.arguments, exec);
			const result = this.createSuccessResult(exec, tool, returned);
			return isAborted(signal) ? toolAbortedResult(result) : result;
		} catch (error) {
			return toolErrorResult(error);
		} finally {
			fused.dispose();
			exec.signal = wrapperSignal;
		}
	}
	/**
	* Run around-dispatch and the tool body. Tool and unknown-tool failures still
	* receive post-execute; pipeline failures are already final.
	* @param exec - the prepared execution.
	* @returns whether the result still needs post-execute.
	* @internal
	*/
	async dispatchScheduledExecution(exec) {
		try {
			const mutableExec = exec;
			const carrier = scopeTarget(this, exec.agent);
			const result = await this.ctx.waterfall(carrier, "tools/execute", mutableExec, () => this.dispatchToolBody(mutableExec));
			const normalized = this.normalizeDispatchResult(exec, result);
			const deferredContexts = this.deferredContexts.get(exec);
			/* v8 ignore next -- dispatch only receives executions minted by this registry's prepare stage */
			if (deferredContexts === void 0) throw new Error("tool registry scheduler invariant violated: unprepared execution");
			const resultWithDeferredContexts = deferredContexts.length === 0 ? normalized : this.markCanonical(exec, {
				...normalized,
				additionalContexts: [...deferredContexts, ...normalized.additionalContexts ?? []]
			});
			return {
				kind: "post-result",
				result: this.callerCancelled(exec) && !resultWithDeferredContexts.isError ? this.cancellationResult(exec, resultWithDeferredContexts) : resultWithDeferredContexts
			};
		} catch (error) {
			return {
				kind: "final-result",
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run ordered post-execute, then apply definition-owned content finalization,
	* materialize, and notify the final outcome.
	* @param exec - the prepared execution.
	* @param result - dispatch/pre result that still needs post-execute.
	* @returns the materialized final result.
	* @internal
	*/
	async finalizeScheduledExecution(exec, result) {
		try {
			const postResult = await this.postExecute(exec, result);
			return this.finishScheduledExecution(exec, this.callerCancelled(exec) && !postResult.isError ? this.cancellationResult(exec, postResult) : postResult);
		} catch (error) {
			return this.finishScheduledExecution(exec, toolErrorResult(error));
		}
	}
	/**
	* Materialize the candidate, apply definition-owned content finalization,
	* then materialize and notify the authoritative result.
	* @param exec - the prepared execution.
	* @param result - final result.
	* @returns the materialized final result.
	* @internal
	*/
	finishScheduledExecution(exec, result) {
		let materializedResult;
		try {
			materializedResult = this.materializeFinalResult(result);
		} catch (error) {
			materializedResult = this.materializeFinalResult(toolErrorResult(error));
		}
		let finalResult;
		try {
			finalResult = this.materializeFinalResult(this.applyFinalContent(exec, materializedResult));
		} catch (error) {
			finalResult = this.materializeFinalResult(toolErrorResult(error));
		}
		this.notifyResult(exec, finalResult);
		return finalResult;
	}
	/** Apply the snapshotted tool-owned content transform without exposing other result fields. */
	applyFinalContent(exec, result) {
		const finalizeContent = this.contentFinalizers.get(exec);
		if (finalizeContent === void 0) return result;
		const content = finalizeContent(exec, result);
		return content === void 0 ? result : {
			...result,
			content
		};
	}
	/** Notify observers without exposing a mutation or error channel into the outcome. */
	notifyResult(exec, result) {
		Object.freeze(exec);
		const { name: toolName, callId } = exec;
		const reportFailure = (error) => {
			this.ctx.logger.warn(`tool "${toolName}" (${callId}): tools/result observer failed: ${errorMessage(error)}`);
		};
		const callbacks = this.ctx.events.dispatch("emit", [
			scopeTarget(this, exec.agent),
			"tools/result",
			exec,
			result
		]);
		for (const callback of callbacks) try {
			const returned = callback(exec, result);
			Promise.resolve(returned).catch(reportFailure);
		} catch (error) {
			reportFailure(error);
		}
	}
	/**
	* Resolve an `ask` decision to allow/deny through the approval seam. The
	* seam is consumed opportunistically with `ctx.get('approval')` — a
	* deployment that composes no ApprovalService keeps the historical degrade
	* to deny, and an unmount mid-session degrades the same way on the next ask.
	* An agent-less execution also degrades: without an agent there is no
	* session to audit to and no UI to route to. Otherwise the outcome maps
	* one-to-one — `allowed-once` proceeds; the three non-grants deny with
	* distinct reasons so the model can tell a human "no" from an absent
	* approval channel.
	*/
	async serviceAsk(exec, ask) {
		const approval = this.ctx.get("approval");
		if (approval === void 0) return {
			decision: {
				kind: "deny",
				reason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)`
			},
			approvalCancelled: false
		};
		if (exec.agent === void 0) return {
			decision: {
				kind: "deny",
				reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`
			},
			approvalCancelled: false
		};
		const outcome = await approval.request({
			agent: exec.agent,
			toolName: exec.name,
			callId: exec.callId,
			...ask.reason !== void 0 ? { reason: ask.reason } : {},
			signal: exec.signal
		});
		switch (outcome) {
			case "allowed-once": return {
				decision: { kind: "allow" },
				approvalCancelled: false
			};
			case "rejected": return {
				decision: {
					kind: "deny",
					reason: `the user rejected tool "${exec.name}"`
				},
				approvalCancelled: false
			};
			case "cancelled": return {
				decision: {
					kind: "deny",
					reason: `approval for tool "${exec.name}" was cancelled`
				},
				approvalCancelled: true
			};
			case "unavailable": return {
				decision: {
					kind: "deny",
					reason: `tool "${exec.name}" requires approval, but no approval channel is available`
				},
				approvalCancelled: false
			};
			default: return assertNever(outcome, "ApprovalOutcome");
		}
	}
	/**
	* Run the `tools/post-execute` waterfall over a dispatched `result` and apply
	* its {@link PostToolDecision}: `accept` keeps the call successful (replacing
	* `content` when given), `block` turns it into an `isError` whose content is
	* the corrective `feedback`. Either decision may attach `additionalContexts`,
	* which are ferried on the returned result for the loop's active-batch FIFO.
	* Context deferred by the tool body survives an accepted result but is
	* discarded when the outer call is blocked; a block exposes only context the
	* blocking decision explicitly supplied.
	* Runs inside `execute`'s outer try/catch (a throwing listener → isError).
	*/
	async postExecute(exec, result) {
		const decision = await this.ctx.waterfall(scopeTarget(this, exec.agent), "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }));
		const decisionContexts = decision.additionalContexts ?? [];
		if (decision.kind === "block") {
			const message = failureMessageFromContent(decision.feedback);
			return this.markCanonical(exec, {
				content: decision.feedback,
				isError: true,
				error: { message },
				...decisionContexts.length > 0 ? { additionalContexts: decisionContexts } : {}
			});
		}
		if (Object.hasOwn(decision, "content") && Object.hasOwn(decision, "value")) throw new TypeError("tools/post-execute accept decision cannot replace both value and content");
		const additionalContexts = [...result.additionalContexts ?? [], ...decisionContexts];
		if (Object.hasOwn(decision, "value")) {
			if (result.isError) throw new TypeError("tools/post-execute cannot replace the value of a failed result");
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (tool === void 0) throw new ToolNotFoundError(exec.name);
			const replaced = this.createSuccessResult(exec, tool, decision.value);
			return this.markCanonical(exec, {
				...replaced,
				...additionalContexts.length > 0 ? { additionalContexts } : {}
			});
		}
		return this.markCanonical(exec, {
			...result,
			...decision.content !== void 0 ? { content: decision.content } : {},
			...additionalContexts.length > 0 ? { additionalContexts } : {}
		});
	}
	/** Registry-normalized results and the exact dispatch that validated each value. */
	canonicalResults = /* @__PURE__ */ new WeakMap();
	/** Mark one registry-normalized result as canonical only for its owning dispatch. */
	markCanonical(exec, result) {
		this.canonicalResults.set(result, exec.token);
		return result;
	}
	/** Snapshot, validate, render, and optionally project one successful body value. */
	createSuccessResult(exec, tool, candidate) {
		const detached = snapshotToolValue(tool.name, candidate);
		const violations = validateJsonSchemaValue(tool.output.schema, detached, "value");
		if (violations.length > 0) throw new ToolOutputError(tool.name, violations);
		const value = deepFreeze(detached);
		let rendered;
		try {
			rendered = tool.output.render(exec.arguments, value);
		} catch (error) {
			throw projectionError(tool.name, "render", error);
		}
		const content = snapshotProjection(tool.name, "render", rendered);
		let meta;
		if (exec.parent === void 0 && tool.output.presentationMeta !== void 0) {
			let projected;
			try {
				projected = tool.output.presentationMeta(exec.arguments, value);
			} catch (error) {
				throw projectionError(tool.name, "presentationMeta", error);
			}
			meta = snapshotProjection(tool.name, "presentationMeta", projected);
		}
		const concludesTurn = this.concludingExecutions.has(exec);
		return this.markCanonical(exec, this.materializeFinalResult({
			isError: false,
			value,
			content,
			...meta !== void 0 ? { meta } : {},
			...concludesTurn ? { concludesTurn: true } : {}
		}));
	}
	/** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
	normalizeDispatchResult(exec, result) {
		if (this.canonicalResults.get(result) === exec.token) return result;
		if (result.isError) return this.markCanonical(exec, {
			isError: true,
			error: result.error,
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (tool === void 0) throw new ToolNotFoundError(exec.name);
		const normalized = this.createSuccessResult(exec, tool, result.value);
		return this.markCanonical(exec, {
			...normalized,
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
	}
	/** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
	materializeFinalResult(result) {
		const presentation = {
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		};
		if (result.isError) return materializePresentation({
			isError: true,
			error: result.error,
			...presentation
		});
		return deepFreeze({
			...materializePresentation({
				isError: false,
				...presentation,
				...result.concludesTurn === true ? { concludesTurn: true } : {}
			}),
			value: result.value
		});
	}
});
/** Mint a same-process correlation token whose identity is its value. */
function createExecutionToken() {
	return Symbol("dsh.tool.execution");
}
function toolErrorResult(error) {
	const info = errorInfo(error);
	const message = errorMessage(error);
	return {
		content: [{
			type: "text",
			text: `Error: ${message}`
		}],
		isError: true,
		error: {
			message,
			...info ? { info } : {}
		}
	};
}
/** Read live abort state across an await without treating it as synchronously immutable. */
function isAborted(signal) {
	return signal.aborted;
}
/**
* Fuse caller and wrapper cancellation without nesting `AbortSignal.any`.
* Keeping the relay dispatch-scoped also removes listeners when work settles.
*/
function fuseToolSignals(caller, wrapper) {
	if (caller === wrapper) return {
		signal: caller,
		dispose() {}
	};
	const controller = new AbortController();
	let listening = false;
	const dispose = () => {
		if (!listening) return;
		listening = false;
		caller.removeEventListener("abort", abortFromCaller);
		wrapper.removeEventListener("abort", abortFromWrapper);
	};
	const abortFrom = (source) => {
		const reason = source.reason;
		controller.abort(reason);
		dispose();
	};
	const abortFromCaller = () => {
		abortFrom(caller);
	};
	const abortFromWrapper = () => {
		abortFrom(wrapper);
	};
	if (wrapper.aborted) abortFromWrapper();
	else if (caller.aborted) abortFromCaller();
	else {
		listening = true;
		caller.addEventListener("abort", abortFromCaller, { once: true });
		wrapper.addEventListener("abort", abortFromWrapper, { once: true });
	}
	return {
		signal: controller.signal,
		dispose
	};
}
/** Canonical result when cancellation supersedes success after body invocation. */
function toolAbortedResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted"
		}],
		isError: true,
		error: {
			message: "tool call aborted",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
/** Canonical result when cancellation prevents tool body invocation. */
function toolAbortedBeforeDispatchResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted before dispatch"
		}],
		isError: true,
		error: {
			message: "tool call aborted before dispatch",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED_BEFORE_DISPATCH
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
//#endregion
//#region lib/types/schema.js
/** Validated on-disk and RPC records. Review baselines change only on an explicit human action. */
const id = z.string().min(1).max(160);
const text = z.string().max(2e6);
/** A source block, with a durable identity independent of its position and content hash. */
const BlockSchema = z.object({
	id,
	kind: z.string(),
	section: z.string(),
	text,
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative()
});
/** Retained figure bytes and their authored destination. */
const FigureAssetSchema = z.object({
	path: z.string(),
	snapshot: z.string(),
	hash: z.string().regex(/^[a-f0-9]{64}$/)
});
/** One immutable imported or accepted manuscript version with optional retained figures. */
const RevisionSchema = z.object({
	id,
	text,
	blocks: z.array(BlockSchema),
	createdAt: z.string(),
	figureAssets: z.array(FigureAssetSchema).optional()
});
/** A quotation anchored to the block and the exact version the reader saw. */
const AnnotationSchema = z.object({
	id,
	blockId: id,
	revision: id,
	quote: text,
	prefix: text,
	suffix: text,
	comment: text,
	renderedSource: text.optional(),
	offset: z.number().int().nonnegative().optional(),
	status: z.enum(["open", "resolved"]),
	anchor: z.enum(["attached", "needs-location"])
});
/** Reader marks retain their source snapshot; removal is reversible and never edits the manuscript. */
const HighlightSchema = z.object({
	id,
	blockId: id,
	revision: id,
	quote: z.string().min(1).max(1e5),
	prefix: text,
	suffix: text,
	renderedSource: text,
	offset: z.number().int().nonnegative(),
	color: z.enum([
		"yellow",
		"green",
		"blue",
		"underline"
	]),
	anchor: z.enum(["attached", "needs-location"]),
	removed: z.boolean()
});
/** Replace or delete an exact block, or insert Markdown beside it; source writes still need acceptance. */
const EditSchema = z.object({
	blockId: id,
	before: text,
	after: text,
	operation: z.enum(["insert-before", "insert-after"]).optional()
});
/** A model proposal is never itself a write authorization. */
const ProposalInputSchema = z.object({
	baseRevision: id,
	annotationIds: z.array(id),
	reason: z.string().min(1).max(4e3),
	meaning: z.enum([
		"style",
		"structure",
		"claim",
		"evidence"
	]),
	edits: z.array(EditSchema).min(1).max(30)
});
/** Update selected fields of a pending proposal against the current reader version. */
const ProposalRevisionInputSchema = z.object({
	proposalId: id,
	revision: id,
	baseRevision: id.optional(),
	...ProposalInputSchema.omit({ baseRevision: true }).partial().shape
}).refine((input) => input.baseRevision !== void 0 || input.annotationIds !== void 0 || input.reason !== void 0 || input.meaning !== void 0 || input.edits !== void 0, "Provide at least one proposal field to revise");
/** A proposal and the deterministic checks recorded when it was submitted. */
const ProposalSchema = ProposalInputSchema.extend({
	id,
	status: z.enum([
		"pending",
		"accepted",
		"rejected"
	]),
	createdAt: z.string(),
	flags: z.array(z.enum([
		"numbers",
		"citations",
		"figures",
		"claim-language",
		"methods",
		"structure"
	])),
	figureChanges: z.array(z.object({
		blockId: id,
		before: FigureAssetSchema,
		after: FigureAssetSchema
	})).optional()
});
/** Snapshot-backed figure replacement; source writes still require acceptance. */
const FigureReplacementSchema = z.object({
	revision: id,
	blockId: id,
	figure: z.string().min(1),
	replacement: z.string().min(1),
	reason: z.string().min(1).max(4e3),
	proposalId: id.optional()
});
/** Per-block human review state; accepting a proposal does not advance it. */
const BaselineSchema = z.object({
	blockId: id,
	revision: id,
	text,
	locked: z.boolean(),
	reviewedAt: z.string(),
	archivedAt: z.string().optional()
});
/** Project-persisted state for one manuscript. No browser storage is authoritative. */
const DocumentSchema = z.object({
	schemaVersion: z.literal(1),
	path: z.string().min(1),
	current: RevisionSchema,
	revisions: z.array(RevisionSchema),
	annotations: z.array(AnnotationSchema),
	proposals: z.array(ProposalSchema),
	highlights: z.array(HighlightSchema).default([]),
	baselines: z.array(BaselineSchema),
	history: z.array(z.object({
		at: z.string(),
		action: z.string(),
		detail: z.string()
	})),
	reading: z.record(z.string(), z.string())
});
/** Model and browser input accepted by the operator RPC dispatcher. */
const CommandSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("open"),
		path: z.string().min(1)
	}),
	z.object({
		action: z.literal("refresh"),
		path: z.string().min(1),
		revision: id
	}),
	z.object({
		action: z.literal("annotate"),
		path: z.string(),
		revision: id,
		blockId: id,
		quote: text,
		prefix: text,
		suffix: text,
		rendered: z.boolean().optional(),
		offset: z.number().int().nonnegative().optional(),
		comment: z.string().min(1).max(4e3)
	}),
	z.object({
		action: z.literal("highlight"),
		path: z.string(),
		revision: id,
		blockId: id,
		quote: z.string().min(1).max(1e5),
		prefix: text,
		suffix: text,
		offset: z.number().int().nonnegative(),
		color: HighlightSchema.shape.color
	}),
	z.object({
		action: z.literal("set-highlight"),
		path: z.string(),
		highlightId: id,
		removed: z.boolean()
	}),
	z.object({
		action: z.literal("resolve"),
		path: z.string(),
		annotationId: id,
		resolved: z.boolean()
	}),
	z.object({
		action: z.literal("review"),
		path: z.string(),
		revision: id,
		blockIds: z.array(id).min(1),
		locked: z.boolean()
	}),
	z.object({
		action: z.literal("unlock"),
		path: z.string(),
		blockId: id
	}),
	z.object({
		action: z.literal("archive-baseline"),
		path: z.string(),
		revision: id,
		blockId: id
	}),
	z.object({
		action: z.literal("restore-baseline"),
		path: z.string(),
		revision: id,
		blockId: id,
		archivedAt: z.string()
	}),
	z.object({
		action: z.literal("relink-baseline"),
		path: z.string(),
		revision: id,
		blockId: id,
		targetBlockId: id
	}),
	z.object({
		action: z.literal("decide"),
		path: z.string(),
		revision: id,
		proposalId: id,
		accept: z.boolean()
	}),
	z.object({
		action: z.literal("position"),
		path: z.string(),
		reader: id,
		blockId: id
	})
]);
/** Wire response, also validates browser reads before rendering. */
const ViewSchema = z.object({
	document: DocumentSchema,
	diskChanged: z.boolean()
});
/** Hash-checked deletion copies exact Markdown on the host rather than through model arguments. */
const DeletionInputSchema = z.object({
	baseRevision: id,
	blockId: id,
	beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
	reason: z.string().min(1).max(4e3),
	proposalId: id.optional()
});
z.object({
	path: z.string(),
	entries: z.array(z.object({
		name: z.string(),
		type: z.enum(["directory", "file"])
	})),
	truncated: z.boolean()
});
z.object({
	files: z.array(z.string()),
	entries: z.array(z.object({
		key: z.string(),
		type: z.string(),
		file: z.string(),
		hash: z.string(),
		fields: z.record(z.string(), z.string())
	})),
	missingKeys: z.array(z.string()),
	possibleBareKeys: z.array(z.string()),
	canonicalCitationCount: z.number().int().nonnegative(),
	citationStatus: z.enum([
		"unbound",
		"missing-keys",
		"possible-legacy-keys",
		"resolved",
		"no-citations"
	])
});
z.object({ result: z.object({
	ok: z.literal(true),
	value: ViewSchema
}) });
//#endregion
//#region lib/types/figures.js
const FIGURE_FILE = /\.(?:pdf|png|jpe?g|webp|gif|svg)$/i;
/**
* Read an explicitly authored figure root from the manuscript's opening provenance comment.
* @param source - pinned Markdown source, not current disk content.
* @returns one safe workspace-relative directory, or the manuscript directory when absent.
*/
function authoredFigureBase(source) {
	const roots = [...(/^\s*<!--([\s\S]*?)-->/.exec(source)?.[1] ?? "").matchAll(/Figure PDFs stay in\s+([^;\n]+)\s*;/gi)];
	if (roots.length !== 1) return "";
	const path = (roots[0]?.[1] ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
	if (!path || path.startsWith("/") || path.includes("://") || path.split("/").some((part) => part === ".." || part === ".paper-review")) return "";
	return path;
}
/** Reject destinations outside the workspace and non-file URLs before offering an opener. */
function localFigurePath(value) {
	const path = value.trim().replace(/\\/g, "/");
	if (!path || path.startsWith("/") || path.includes("://") || path.split("/").some((part) => part === ".." || part === ".paper-review") || !FIGURE_FILE.test(path)) return void 0;
	return path;
}
/**
* Find explicit figure captions and ordinary Markdown images in displayed blocks.
* @param blocks - pinned reader revision.
* @returns selectable local figure references in manuscript order.
*/
function collectFigures(blocks) {
	const figures = [];
	const seen = /* @__PURE__ */ new Set();
	for (const block of blocks) {
		if (block.kind === "code") continue;
		const add = (label, value) => {
			const path = localFigurePath(value);
			if (!path || seen.has(`${block.id}:\0${path}`)) return;
			seen.add(`${block.id}:\0${path}`);
			figures.push({
				blockId: block.id,
				label: label.trim() || path.split("/").at(-1) || path,
				path
			});
		};
		for (const match of block.text.matchAll(/\*\*(Figure\s+(?:\[[^\]]+\]|[\w.-]+))\*\*\s*\(\s*`([^`]+)`\s*\)/gi)) add(match[1] ?? "", match[2] ?? "");
		for (const match of block.text.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g)) add(match[1] ?? "", match[2] ?? match[3] ?? "");
	}
	return figures;
}
/**
* Resolve one authored destination under the manuscript directory or its provenance-declared figure root.
* @param manuscript - workspace-relative Markdown file.
* @param base - optional workspace-relative root declared in Markdown provenance.
* @param path - validated local figure path.
* @returns workspace-relative file path for the native DSH preview.
*/
function figureFilePath(manuscript, base, path) {
	const figure = localFigurePath(path);
	const directory = base || manuscript.slice(0, Math.max(0, manuscript.lastIndexOf("/")));
	if (!figure || directory.startsWith("/") || directory.split("/").includes("..")) return void 0;
	return [directory, figure].filter(Boolean).join("/");
}
/**
* Use retained figure bytes when this reader revision has a recorded snapshot.
* @param revision - pinned reader version.
* @param figure - authored reference in that version.
* @returns reference with its snapshot destination, otherwise unchanged.
*/
function pinnedFigure(revision, figure) {
	const retained = revision.figureAssets?.find((asset) => asset.path === figure.path);
	return retained ? {
		...figure,
		path: retained.snapshot
	} : figure;
}
/**
* Replace selected figure destinations without changing caption prose or other paths.
* @param block - exact source block.
* @param path - selected authored destination.
* @param replacement - retained replacement destination.
* @returns source with matching caption or Markdown image references updated.
*/
function replaceFigureReference(block, path, replacement) {
	return block.text.replace(/(\*\*Figure\s+(?:\[[^\]]+\]|[\w.-]+)\*\*\s*\(\s*`)([^`]+)(`\s*\))/gi, (whole, prefix, destination, suffix) => destination === path ? prefix + replacement + suffix : whole).replace(/(!\[[^\]]*\]\(\s*)(?:<([^>]+)>|([^\s)]+))((?:\s+[^)]*)?\))/g, (whole, prefix, angled, plain, suffix) => {
		if ((angled ?? plain) !== path) return whole;
		return prefix + (angled === void 0 ? replacement : `<${replacement}>`) + suffix;
	});
}
//#endregion
//#region lib/types/document.js
/** Source-preserving Markdown blocks, conservative anchor migration and mechanical change checks. */
/**
* Hash exact UTF-8 source, including whitespace.
* @param text - source.
* @returns revision identity.
*/
function revisionId(text) {
	return createHash("sha256").update(text).digest("hex");
}
/**
* Preserve ids only for unambiguous exact blocks or explicit accepted replacements.
* @param text - complete source.
* @param previous - preceding parsed revision.
* @param replacements - accepted replacements indexed by old id.
* @returns source-offset blocks; ambiguous external rewrites get new ids.
*/
function parseRevision(text, previous, replacements = /* @__PURE__ */ new Map()) {
	const root = fromMarkdown(text, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()]
	});
	let section = "";
	const blocks = root.children.map((node) => {
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		if (start === void 0 || end === void 0) throw new Error("Markdown block has no source offsets");
		const raw = text.slice(start, end);
		if (node.type === "heading") section = raw.replace(/^#+\s*/, "");
		return {
			id: randomUUID(),
			kind: node.type,
			section,
			text: raw,
			start,
			end
		};
	});
	for (const block of blocks) {
		const candidates = previous?.blocks.filter((old) => (replacements.get(old.id) ?? old.text) === block.text && old.kind === block.kind) ?? [];
		const candidate = candidates[0];
		if (candidate && candidates.length === 1 && blocks.filter((b) => b.text === block.text && b.kind === block.kind).length === 1) block.id = candidate.id;
	}
	const paths = new Set(collectFigures(blocks).map((figure) => figure.path));
	const figureAssets = previous?.figureAssets?.filter((asset) => paths.has(asset.path));
	return {
		id: revisionId(text),
		text,
		blocks,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		...figureAssets?.length ? { figureAssets } : {}
	};
}
/**
* Refuse ambiguous or missing quotations instead of guessing their new location.
* @param annotations - prior anchors.
* @param revision - current source.
* @returns migrated anchor statuses with their original quotation and version intact.
*/
function migrateAnnotations(annotations, revision) {
	return annotations.map((annotation) => {
		const block = revision.blocks.find((b) => b.id === annotation.blockId);
		const quote = annotation.quote;
		const needle = annotation.prefix + quote + annotation.suffix;
		const occurrences = (source, target) => target ? source.split(target).length - 1 : 0;
		const attached = block !== void 0 && (annotation.renderedSource !== void 0 ? block.text === annotation.renderedSource : quote === "" || occurrences(block.text, needle) === 1 || occurrences(block.text, quote) === 1);
		return {
			...annotation,
			anchor: attached ? "attached" : "needs-location"
		};
	});
}
/**
* Detect lexical changes that merit review, without certifying scientific meaning.
* @param proposal - raw edits and author-declared meaning.
* @param blocks - source blocks for Methods context.
* @returns independent mechanical risk labels.
*/
function checkChanges(proposal, blocks) {
	const flags = /* @__PURE__ */ new Set();
	const patterns = [
		["numbers", /(?:\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\s*(?:%|mg|kg|mm|cm|mL|μm|µm|s\b)?)/gi],
		["citations", /\[@[^\]]+\]|\[cite:\s*[^\]]+\]|\\cite\w*\{[^}]+\}|\[\d+(?:[-,–]\s*\d+)*\]|\b[a-z][a-z0-9:_-]*(?:19|20)\d{2}[a-z]?\b/g],
		["figures", /\b(?:fig(?:ure)?\.?|table|supplement(?:ary)?|extended data)\s*[\da-z.()-]+/gi],
		["claim-language", /\b(?:all|always|consistently|significant(?:ly)?|robust(?:ly)?|generali[sz]\w*|caus\w*|prove\w*|superior|outperform\w*|novel|first|only|may|might|not|no)\b|所有|显著|因果|证明|泛化|优于|首次|可能|未|不/g]
	];
	for (const edit of proposal.edits) {
		for (const [flag, pattern] of patterns) {
			const before = edit.operation ? "" : edit.before;
			if (JSON.stringify(before.match(pattern) ?? []) !== JSON.stringify(edit.after.match(pattern) ?? [])) flags.add(flag);
		}
		if (/method|方法/i.test(blocks.find((b) => b.id === edit.blockId)?.section ?? "")) flags.add("methods");
		const original = blocks.find((block) => block.id === edit.blockId);
		const resulting = edit.operation ? [] : parseRevision(edit.after).blocks;
		if (proposal.meaning === "structure" || edit.operation || resulting.length !== 1 || resulting[0]?.kind !== original?.kind) flags.add("structure");
	}
	return [...flags];
}
//#endregion
//#region lib/types/review-blocks.js
/**
* Hide a top-level bibliography section without altering manuscript source.
* @param blocks - parsed manuscript blocks.
* @returns blocks visible in the reader.
*/
function readingBlocks(blocks) {
	let hiddenLevel = 0;
	return blocks.filter((block) => {
		if (block.kind === "heading") {
			const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(block.text);
			if (match) {
				const level = (match[1] ?? "").length;
				if (hiddenLevel && level <= hiddenLevel) hiddenLevel = 0;
				if (level <= 2 && /^(?:references|bibliography)$/i.test(match[2] ?? "")) hiddenLevel = level;
			}
		}
		return !hiddenLevel;
	});
}
/**
* Exclude provenance comments and bibliography from the human-review denominator.
* @param blocks - parsed manuscript blocks.
* @returns blocks that count toward review progress.
*/
function reviewableBlocks(blocks) {
	return readingBlocks(blocks).filter((block) => !(block.kind === "html" && /^\s*<!--/.test(block.text)));
}
//#endregion
//#region lib/types/bibliography.js
/** BibTeX entry indexing and manuscript citation checks; `.bib` files remain authoritative. */
const KEY = /^[A-Za-z][A-Za-z0-9_:./-]*$/;
const CITE = /\[@([^\]]+)\]/g;
const BARE_YEAR_KEY = /\b[a-z][a-z0-9:_-]*(?:19|20)\d{2}[a-z]?\b/g;
function withoutInlineCode(text) {
	return text.replace(/(`+)([\s\S]*?)\1/g, (value) => " ".repeat(value.length));
}
function withoutCanonicalCitations(text) {
	return withoutInlineCode(text).replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$[^\n$]*(?<!\\)\$/g, (value) => " ".repeat(value.length)).replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, (value) => " ".repeat(value.length)).replace(CITE, (value) => " ".repeat(value.length));
}
/**
* Find likely unmarked citation keys in prose, ignoring code, math, and canonical citations.
* @param text - manuscript Markdown to inspect.
* @param boundKeys - keys available in the bound BibTeX files.
* @returns possible bare keys for author review, not verified citations.
*/
function possibleBareCitationKeys(text, boundKeys) {
	const prose = withoutCanonicalCitations(text);
	const found = new Set(prose.match(BARE_YEAR_KEY) ?? []);
	for (const key of boundKeys) {
		const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(prose)) found.add(key);
	}
	return [...found];
}
function matching(text, start, open, close) {
	if (open === "\"") {
		for (let at = start + 1; at < text.length; at++) {
			if (text[at] === "\\") {
				at++;
				continue;
			}
			if (text[at] === "\"") return at;
		}
		throw new Error("BibTeX quoted field is unclosed");
	}
	let depth = 0;
	let quoted = false;
	for (let at = start; at < text.length; at++) {
		const char = text[at];
		if (char === "\\") {
			at++;
			continue;
		}
		if (char === "\"") {
			quoted = !quoted;
			continue;
		}
		if (quoted) continue;
		if (char === open) depth++;
		else if (char === close && --depth === 0) return at;
	}
	throw new Error("BibTeX entry has an unclosed delimiter");
}
function fieldsOf(body) {
	const fields = {};
	let at = 0;
	while (at < body.length) {
		while (/[\s,]/.test(body[at] ?? "") && at < body.length) at++;
		if (at >= body.length) break;
		const name = /^[A-Za-z][A-Za-z0-9_-]*/.exec(body.slice(at))?.[0];
		if (!name) throw new Error("BibTeX field name is invalid");
		at += name.length;
		while (/\s/.test(body[at] ?? "") && at < body.length) at++;
		if (body[at++] !== "=") throw new Error(`BibTeX field ${name} needs =`);
		while (/\s/.test(body[at] ?? "") && at < body.length) at++;
		let value = "";
		if (body[at] === "{" || body[at] === "\"") {
			const start = at;
			const opener = body[at] === "{" ? "{" : "\"";
			const end = matching(body, start, opener, opener === "{" ? "}" : "\"");
			value = body.slice(start + 1, end);
			at = end + 1;
		} else {
			const end = body.indexOf(",", at);
			value = body.slice(at, end < 0 ? void 0 : end).trim();
			at = end < 0 ? body.length : end;
		}
		if (!value.trim()) throw new Error(`BibTeX field ${name} is empty`);
		fields[name.toLowerCase()] = value.trim();
		while (/\s/.test(body[at] ?? "") && at < body.length) at++;
		if (at < body.length && body[at] !== ",") throw new Error(`BibTeX field ${name} is followed by unsupported syntax`);
	}
	return fields;
}
/**
* Index entries without rewriting BibTeX syntax or expanding macros.
* @param text - exact source file.
* @param file - workspace-relative source identity.
* @returns entries with exact raw ranges for conflict-checked replacement.
*/
function parseBibtex(text, file) {
	const entries = [];
	let at = 0;
	while (at < text.length) {
		if (text[at] === "%") {
			at = text.indexOf("\n", at) + 1 || text.length;
			continue;
		}
		if (text[at] !== "@") {
			at++;
			continue;
		}
		const start = at;
		const type = /^@[A-Za-z]+/.exec(text.slice(at))?.[0].slice(1);
		if (!type) throw new Error(`Invalid BibTeX entry at offset ${at}`);
		at += type.length + 1;
		while (/\s/.test(text[at] ?? "") && at < text.length) at++;
		const open = text[at];
		if (open !== "{" && open !== "(") throw new Error(`BibTeX ${type} needs an opening delimiter`);
		const end = matching(text, at, open, open === "{" ? "}" : ")");
		const raw = text.slice(start, end + 1);
		const content = text.slice(at + 1, end);
		at = end + 1;
		if (/^(?:comment|string|preamble)$/i.test(type)) continue;
		const comma = content.indexOf(",");
		if (comma < 0) throw new Error(`BibTeX ${type} has no key separator`);
		const key = content.slice(0, comma).trim();
		if (!KEY.test(key)) throw new Error(`Invalid BibTeX key: ${key}`);
		entries.push({
			key,
			type: type.toLowerCase(),
			raw,
			hash: createHash("sha256").update(raw).digest("hex"),
			fields: fieldsOf(content.slice(comma + 1)),
			file
		});
	}
	return entries;
}
/**
* Find canonical citations outside inline code while retaining source offsets.
* @param text - Markdown source block.
* @returns recognized canonical citations.
*/
function citationsIn(text) {
	return [...withoutInlineCode(text).matchAll(CITE)].flatMap((match) => {
		const keys = match[1]?.split(";").map((part, index) => {
			const item = part.trim();
			return index === 0 ? item : item.startsWith("@") ? item.slice(1) : "";
		}) ?? [];
		return keys.length > 0 && keys.every((key) => KEY.test(key)) ? [{
			keys,
			raw: match[0],
			start: match.index,
			end: match.index + match[0].length
		}] : [];
	});
}
function count(values) {
	const counts = /* @__PURE__ */ new Map();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return counts;
}
/**
* Reject newly introduced unresolved or unmarked citations without blocking unchanged legacy prose.
* @param before - exact source block before a proposal.
* @param after - proposed replacement.
* @param keys - keys in the bound `.bib` files, or null when no files are bound.
*/
function assertNewCitations(before, after, keys) {
	const old = count(citationsIn(before).flatMap((citation) => citation.keys));
	const next = count(citationsIn(after).flatMap((citation) => citation.keys));
	for (const [key, amount] of next) {
		if (amount <= (old.get(key) ?? 0)) continue;
		if (!keys) throw new Error("Bind the authoritative .bib files before adding citations");
		if (!keys.has(key)) throw new Error(`Citation [@${key}] has no entry in the bound .bib files`);
	}
	const oldBare = count(withoutCanonicalCitations(before).match(BARE_YEAR_KEY) ?? []);
	for (const [key, amount] of count(withoutCanonicalCitations(after).match(BARE_YEAR_KEY) ?? [])) if (amount > (oldBare.get(key) ?? 0)) throw new Error(`Use [@${key}] instead of an unmarked citation key`);
	if ((after.match(/\[cite:\s*[^\]]+\]/g) ?? []).length > (before.match(/\[cite:\s*[^\]]+\]/g) ?? []).length) throw new Error("Use [@key] instead of [cite: key] for new citations");
}
//#endregion
//#region lib/types/owner-lock.js
/** Cross-process workspace ownership with automatic release on process exit. */
const OwnerSchema = z.object({
	pid: z.number().int().positive(),
	kernel: z.literal(true).optional()
});
function codeIs(error, code) {
	return error?.code === code;
}
function locked(path) {
	return /* @__PURE__ */ new Error(`Paper review workspace is locked: ${path}. Close the other review instance and try again.`);
}
function sameFile(first, second) {
	return first.dev === second.dev && first.ino === second.ino;
}
function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (codeIs(error, "ESRCH")) return false;
		if (codeIs(error, "EPERM")) return true;
		throw error;
	}
}
async function posixLock(path) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 384);
		try {
			try {
				await tryLockExclusive(handle.fd);
			} catch (error) {
				if (codeIs(error, "EAGAIN") || codeIs(error, "EWOULDBLOCK")) throw locked(path);
				throw error;
			}
			const held = await handle.stat({ bigint: true });
			const current = await lstat(path, { bigint: true }).catch((error) => {
				if (codeIs(error, "ENOENT")) return void 0;
				throw error;
			});
			if (current?.isFile() && sameFile(held, current)) return () => handle.close();
		} catch (error) {
			await handle.close();
			throw error;
		}
		await handle.close();
	}
	throw new Error(`Paper review lock path changed during acquisition: ${path}`);
}
async function windowsLock(path) {
	const kernel32 = (await import("koffi")).default.load("kernel32.dll");
	const create = kernel32.func("__stdcall", "CreateSemaphoreW", "intptr", [
		"void*",
		"int",
		"int",
		"str16"
	]);
	const wait = kernel32.func("__stdcall", "WaitForSingleObject", "uint", ["intptr", "uint"]);
	const release = kernel32.func("__stdcall", "ReleaseSemaphore", "int", [
		"intptr",
		"int",
		"void*"
	]);
	const close = kernel32.func("__stdcall", "CloseHandle", "int", ["intptr"]);
	const lastError = kernel32.func("__stdcall", "GetLastError", "uint", []);
	const handle = create(null, 1, 1, `Local\\dsh-paper-review-${createHash("sha256").update(resolve(path).toLowerCase()).digest("hex")}`);
	if (handle === 0) throw new Error(`CreateSemaphoreW failed (${lastError()}): ${path}`);
	const result = wait(handle, 0);
	if (result !== 0) {
		const error = result === 258 ? locked(path) : /* @__PURE__ */ new Error(`WaitForSingleObject failed (${lastError()}): ${path}`);
		close(handle);
		throw error;
	}
	return () => {
		const released = release(handle, 1, null);
		const closed = close(handle);
		if (released === 0 || closed === 0) throw new Error(`Paper review lock release failed (${lastError()}): ${path}`);
		return Promise.resolve();
	};
}
async function readOwner(path) {
	const handle = await open(path, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW)).catch((error) => {
		if (codeIs(error, "ENOENT")) return void 0;
		throw error;
	});
	if (!handle) return void 0;
	try {
		const info = await handle.stat({ bigint: true });
		if (!info.isFile() || info.size > 256n) throw new Error(`Cannot verify paper review owner lock: ${path}`);
		const parsed = OwnerSchema.safeParse(JSON.parse(await handle.readFile("utf8")));
		if (!parsed.success) throw new Error(`Cannot verify paper review owner lock: ${path}`);
		return {
			dev: info.dev,
			ino: info.ino,
			pid: parsed.data.pid,
			kernel: parsed.data.kernel === true
		};
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Cannot verify paper review owner lock: ${path}`, { cause: error });
		throw error;
	} finally {
		await handle.close();
	}
}
async function createOwner(path) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	const handle = await open(temporary, "wx", 384);
	let identity;
	try {
		await handle.writeFile(JSON.stringify({
			pid: process.pid,
			kernel: true
		}));
		await handle.sync();
		const info = await handle.stat({ bigint: true });
		identity = {
			dev: info.dev,
			ino: info.ino
		};
	} catch (error) {
		await handle.close();
		await unlink(temporary).catch((cleanupError) => {
			if (!codeIs(cleanupError, "ENOENT")) process.emitWarning(cleanupError instanceof Error ? cleanupError : String(cleanupError));
		});
		throw error;
	}
	await handle.close();
	try {
		await link(temporary, path);
		return identity;
	} finally {
		await unlink(temporary).catch((error) => {
			if (!codeIs(error, "ENOENT")) process.emitWarning(error instanceof Error ? error : String(error));
		});
	}
}
/**
* Hold a kernel lock while preserving the legacy owner.lock barrier for older plugin processes.
* A dead legacy PID can be adopted under the kernel lock; a live or unverifiable owner is refused.
* @param stateRoot - canonical private `.paper-review` directory.
* @returns Cleanup that removes this instance's legacy barrier and releases the kernel lock.
*/
async function acquireOwnerLock(stateRoot) {
	const path = resolve(stateRoot, "owner.lock");
	const kernelPath = resolve(stateRoot, "owner.kernel.lock");
	const releaseKernel = process.platform === "win32" ? await windowsLock(kernelPath) : await posixLock(kernelPath);
	try {
		let identity;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const existing = await readOwner(path);
			if (existing) {
				const current = await lstat(path, { bigint: true }).catch((error) => {
					if (codeIs(error, "ENOENT")) return void 0;
					throw error;
				});
				if (!current || !sameFile(existing, current)) continue;
				if (!existing.kernel && processAlive(existing.pid)) throw locked(path);
				identity = existing;
				break;
			}
			try {
				identity = await createOwner(path);
				break;
			} catch (error) {
				if (!codeIs(error, "EEXIST")) throw error;
			}
		}
		if (!identity) throw locked(path);
		return async () => {
			try {
				const current = await lstat(path, { bigint: true }).catch((error) => {
					if (codeIs(error, "ENOENT")) return void 0;
					throw error;
				});
				if (current && sameFile(identity, current)) await unlink(path);
			} finally {
				await releaseKernel();
			}
		};
	} catch (error) {
		await releaseKernel();
		throw error;
	}
}
//#endregion
//#region lib/types/store.js
/** Local manuscript state, serialized operator actions, and recoverable source acceptance. */
const JournalSchema = z.object({
	before: z.string(),
	after: z.string(),
	next: DocumentSchema
});
const BibBindingsSchema = z.record(z.string(), z.array(z.string()));
/** Retain an unchanged anchor when a model supplies it beside new Markdown blocks. */
function normalizeBlockInsertions(proposal) {
	return {
		...proposal,
		edits: proposal.edits.map((edit) => {
			if (edit.operation) return edit;
			const blocks = parseRevision(edit.after).blocks;
			const first = blocks[0];
			const last = blocks.at(-1);
			if (blocks.length < 2 || !first || !last) return edit;
			const second = blocks[1];
			const penultimate = blocks.at(-2);
			if (!second || !penultimate) return edit;
			if (first.text === edit.before && /\r?\n[ \t]*\r?\n/.test(edit.after.slice(first.end, second.start))) return {
				...edit,
				operation: "insert-after",
				after: edit.after.slice(second.start, last.end)
			};
			if (last.text === edit.before && /\r?\n[ \t]*\r?\n/.test(edit.after.slice(penultimate.end, last.start))) return {
				...edit,
				operation: "insert-before",
				after: edit.after.slice(first.start, penultimate.end)
			};
			return edit;
		})
	};
}
/** Check only that Markdown cannot consume neighboring source when inserted or replaced. */
function assertStandaloneFragment(fragment) {
	if (!fragment.trim()) throw new Error("Insert non-empty Markdown; use an empty replacement to propose deleting a block");
	const marker = `paperReviewBoundary${randomUUID().replaceAll("-", "")}`;
	const blocks = parseRevision(`${marker}Before\n\n${fragment}\n\n${marker}After`).blocks;
	if (blocks.length < 3 || blocks[0]?.text !== `${marker}Before` || blocks.at(-1)?.text !== `${marker}After`) throw new Error("Markdown fragment must leave neighboring blocks intact; close fences or other open constructs");
}
/** Citation keys inside code or raw HTML are examples, not manuscript citations. */
function citationSource(fragment) {
	return parseRevision(fragment).blocks.filter((block) => block.kind !== "code" && block.kind !== "html").map((block) => block.text).join("\n\n");
}
/** Atomic file replacement preserving source permissions. @param path - destination. @param text - bytes to publish. */
async function atomicWrite(path, text) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	const handle = await open(temporary, "wx", await stat(path).then((info) => info.mode & 511, (error) => {
		if (missing(error)) return 384;
		throw error;
	}));
	try {
		await handle.writeFile(text);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await rename(temporary, path);
	} catch (error) {
		await unlink(temporary);
		throw error;
	}
}
function missing(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
/**
* Read the explicitly enabled review sessions without acquiring workspace ownership.
* @param root - session workspace.
* @returns persisted session ids; an untouched workspace has none.
*/
async function reviewSessions(root) {
	const stored = await readFile(resolve(root, ".paper-review", "sessions.json"), "utf8").catch((error) => {
		if (missing(error)) return void 0;
		throw error;
	});
	return stored === void 0 ? [] : z.array(z.string()).parse(JSON.parse(stored));
}
/** One local workspace owner, with state stored beside the manuscript under `.paper-review`. */
var PaperStore = class {
	workspaceRoot;
	maxBytes;
	maxFigureBytes;
	root = "";
	stateRoot = "";
	releaseLock;
	tail = Promise.resolve();
	closed = false;
	/** @param workspaceRoot - local project. @param maxBytes - source byte cap. @param maxFigureBytes - retained figure byte cap. */
	constructor(workspaceRoot, maxBytes, maxFigureBytes = 64 * 1024 * 1024) {
		this.workspaceRoot = workspaceRoot;
		this.maxBytes = maxBytes;
		this.maxFigureBytes = maxFigureBytes;
	}
	/** Acquire exclusive plugin ownership before serving any request. */
	async start() {
		this.root = await realpath(this.workspaceRoot);
		this.stateRoot = resolve(this.root, ".paper-review");
		await mkdir(this.stateRoot, {
			recursive: true,
			mode: 448
		});
		if (await realpath(this.stateRoot) !== this.stateRoot) throw new Error(".paper-review must not be a symlink");
		this.releaseLock = await acquireOwnerLock(this.stateRoot);
	}
	/** Refuse new work, drain accepted operations, and release workspace ownership. */
	async close() {
		this.closed = true;
		await this.tail;
		await this.releaseLock?.();
		this.releaseLock = void 0;
	}
	serial(operation) {
		if (this.closed) return Promise.reject(/* @__PURE__ */ new Error("Paper review is closing"));
		const result = this.tail.then(operation);
		this.tail = result.catch(() => void 0);
		return result;
	}
	/**
	* Persist an explicit session opt-in before the next model turn.
	* @param sessionId - native DSH session identity.
	*/
	enableSession(sessionId) {
		return this.serial(async () => {
			const sessions = await reviewSessions(this.root);
			if (!sessions.includes(sessionId)) await atomicWrite(resolve(this.stateRoot, "sessions.json"), JSON.stringify([...sessions, sessionId]));
		});
	}
	/**
	* Hide active manuscript tools for one idle session without discarding manuscript state.
	* @param sessionId - native DSH session identity.
	*/
	disableSession(sessionId) {
		return this.serial(async () => {
			const sessions = await reviewSessions(this.root);
			if (sessions.includes(sessionId)) await atomicWrite(resolve(this.stateRoot, "sessions.json"), JSON.stringify(sessions.filter((id) => id !== sessionId)));
			const paths = await this.sessionPaths();
			if (sessionId in paths) {
				const remaining = Object.fromEntries(Object.entries(paths).filter(([id]) => id !== sessionId));
				await atomicWrite(resolve(this.stateRoot, "session-paths.json"), JSON.stringify(remaining));
			}
		});
	}
	async sessionPaths() {
		const stored = await readFile(resolve(this.stateRoot, "session-paths.json"), "utf8").catch((error) => {
			if (missing(error)) return void 0;
			throw error;
		});
		return stored === void 0 ? {} : z.record(z.string(), z.string()).parse(JSON.parse(stored));
	}
	/**
	* Read the manuscript selected for this conversation.
	* @param sessionId - conversation identity.
	* @returns last selected workspace-relative path, or null if none.
	*/
	selectedPath(sessionId) {
		return this.serial(async () => (await this.sessionPaths())[sessionId] ?? null);
	}
	/**
	* Persist the selected manuscript for later browser windows and resumed turns.
	* @param sessionId - conversation identity.
	* @param path - already validated relative manuscript path.
	* @returns when the selection has been saved.
	*/
	selectPath(sessionId, path) {
		return this.serial(async () => {
			const paths = await this.sessionPaths();
			paths[sessionId] = path;
			await atomicWrite(resolve(this.stateRoot, "session-paths.json"), JSON.stringify(paths));
		});
	}
	/**
	* List one workspace directory for manuscript or BibTeX selection.
	* @param path - workspace-relative directory, or an empty string for the root.
	* @param extension - file suffix to list alongside directories.
	* @returns bounded visible folders and matching files, with truncation state.
	*/
	listFiles(path, extension = "md") {
		return this.serial(async () => {
			if (isAbsolute(path) || path.split(/[\\/]/).some((part) => part === ".." || part === ".paper-review")) throw new Error("Choose a directory inside the manuscript workspace");
			const directory = await realpath(resolve(this.root, path));
			const relativePath = relative(this.root, directory);
			if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error("Directory must be inside the manuscript workspace");
			if (!(await stat(directory)).isDirectory()) throw new Error("Choose a directory");
			const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isFile() && (extension === "figure" ? /\.(?:pdf|png|jpe?g|webp|gif|svg)$/i.test(entry.name) : entry.name.toLowerCase().endsWith(`.${extension}`)))).map((entry) => ({
				name: entry.name,
				type: entry.isDirectory() ? "directory" : "file"
			})).sort((a, b) => Number(a.type === "file") - Number(b.type === "file") || a.name.localeCompare(b.name, void 0, { numeric: true }));
			return {
				path: relativePath === "" ? "" : relativePath.split(sep).join("/"),
				entries: entries.slice(0, 500),
				truncated: entries.length > 500
			};
		});
	}
	/**
	* Resolve a local figure for DSH's native PDF/image preview, without reading media bytes.
	* @param path - workspace-relative file path from a manuscript reference.
	* @returns canonical file path, confined to this review workspace.
	*/
	figurePath(path) {
		return this.serial(() => this.resolveFigure(path));
	}
	async resolveFigure(path) {
		if (!path || isAbsolute(path) || path.split(/[\\/]/).some((part) => part === ".." || part === ".paper-review") || !/\.(?:pdf|png|jpe?g|webp|gif|svg)$/i.test(path)) throw new Error("Choose a local PDF or image inside the manuscript workspace");
		const source = await realpath(resolve(this.root, path));
		const normalized = relative(this.root, source);
		if (normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized) || normalized.split(sep).includes(".paper-review")) throw new Error("Figure must remain inside the manuscript workspace");
		if (!(await stat(source)).isFile()) throw new Error("Figure must be a regular file");
		return source;
	}
	/**
	* List exact figure references and retained destinations in the current manuscript.
	* @param path - manuscript path.
	* @returns reader revision, source-change flag and workspace-relative figure files.
	*/
	listFigures(path) {
		return this.serial(async () => {
			const { document, disk } = await this.load(path);
			const base = authoredFigureBase(document.current.text);
			return {
				revision: document.current.id,
				diskChanged: revisionId(disk) !== document.current.id,
				figures: collectFigures(document.current.blocks).map((figure) => {
					const hash = document.current.figureAssets?.find((asset) => asset.path === figure.path)?.hash;
					return {
						...figure,
						file: figureFilePath(document.path, base, pinnedFigure(document.current, figure).path) ?? null,
						...hash ? { hash } : {}
					};
				})
			};
		});
	}
	async figureData(path) {
		const handle = await open(await this.resolveFigure(path), "r");
		try {
			if ((await handle.stat()).size > this.maxFigureBytes) throw new Error("Figure exceeds maxFigureBytes; choose a smaller file or raise the configured limit");
			const data = await handle.readFile();
			if (!data.length || data.length > this.maxFigureBytes) throw new Error("Figure is empty or exceeds maxFigureBytes");
			return data;
		} finally {
			await handle.close();
		}
	}
	async retainFigure(directory, path, authoredPath) {
		const data = await this.figureData(path);
		const hash = createHash("sha256").update(data).digest("hex");
		const snapshot = `figures/review-assets/${hash}.${path.split(".").at(-1)?.toLowerCase()}`;
		const relativePath = [directory, snapshot].filter(Boolean).join("/");
		const folder = resolve(this.root, directory, "figures/review-assets");
		for (const part of [
			directory,
			[directory, "figures"].filter(Boolean).join("/"),
			[directory, "figures/review-assets"].filter(Boolean).join("/")
		]) {
			const existing = await realpath(resolve(this.root, part)).catch((error) => {
				if (missing(error)) return void 0;
				throw error;
			});
			if (existing !== void 0) {
				const inside = relative(this.root, existing);
				if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("Figure snapshot directory escapes the workspace");
			}
		}
		await mkdir(folder, { recursive: true });
		const normalized = relative(this.root, await realpath(folder));
		if (normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) throw new Error("Figure snapshot directory escapes the workspace");
		const destination = resolve(this.root, relativePath);
		try {
			const handle = await open(destination, "wx", 292);
			try {
				await handle.writeFile(data);
				await handle.sync();
			} finally {
				await handle.close();
			}
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
			if (createHash("sha256").update(await this.figureData(relativePath)).digest("hex") !== hash) throw new Error("Retained figure bytes changed; restore the snapshot before continuing");
		}
		return {
			path: authoredPath,
			snapshot,
			hash
		};
	}
	/**
	* Retain both images and submit or revise one figure-reference proposal without writing Markdown.
	* @param path - manuscript path.
	* @param input - exact block, reader version, authored figure and workspace replacement file.
	* @returns pending proposal state; acceptance still uses the ordinary source and lock checks.
	*/
	replaceFigure(path, input) {
		return this.serial(async () => {
			const request = FigureReplacementSchema.parse(input);
			const { document, key, disk } = await this.load(path);
			this.assertRevision(document, request.revision);
			if (revisionId(disk) !== document.current.id) throw new Error("Load external manuscript changes before replacing a figure");
			const block = document.current.blocks.find((candidate) => candidate.id === request.blockId);
			const figure = block && collectFigures([block]).find((candidate) => candidate.path === request.figure);
			if (!block || !figure) throw new Error("Figure reference no longer exists; use paper_figure_list and reread the block");
			if (document.baselines.some((base) => !base.archivedAt && base.blockId === block.id && base.locked)) throw new Error("Unlock the reviewed figure block before replacing its figure");
			const previous = request.proposalId ? document.proposals.find((proposal) => proposal.id === request.proposalId) : void 0;
			if (request.proposalId && (!previous || previous.status !== "pending")) throw new Error("Proposal is no longer pending");
			const previousEdit = previous?.edits.find((edit) => edit.blockId === block.id && edit.operation === void 0);
			if (previous && (previous.baseRevision !== document.current.id || previousEdit && previousEdit.before !== block.text)) throw new Error("Reread and rebase the pending proposal before replacing its figure");
			const directory = authoredFigureBase(document.current.text) || document.path.slice(0, Math.max(0, document.path.lastIndexOf("/")));
			const currentPath = figureFilePath(document.path, directory, pinnedFigure(document.current, figure).path);
			if (!currentPath) throw new Error("Figure path cannot be resolved inside this workspace");
			const before = await this.retainFigure(directory, currentPath, figure.path);
			const after = await this.retainFigure(directory, request.replacement, figure.path);
			if (before.hash === after.hash) throw new Error("Replacement figure has identical bytes");
			after.path = after.snapshot;
			const priorDestination = (previous?.figureChanges?.find((change) => change.blockId === block.id && change.before.path === figure.path))?.after.path ?? figure.path;
			const pendingBlock = {
				...block,
				text: previousEdit?.after ?? block.text
			};
			if (!collectFigures([pendingBlock]).some((candidate) => candidate.path === priorDestination)) throw new Error("Pending proposal no longer contains the selected figure reference");
			const updated = replaceFigureReference(pendingBlock, priorDestination, after.path);
			const edited = {
				blockId: block.id,
				before: block.text,
				after: updated
			};
			const candidate = {
				baseRevision: document.current.id,
				annotationIds: previous?.annotationIds ?? [],
				meaning: previous?.meaning ?? "structure",
				reason: request.reason,
				edits: [...previous?.edits.filter((edit) => edit.blockId !== block.id) ?? [], edited]
			};
			const flags = await this.proposalFlags(document, candidate);
			const figureChanges = [...previous?.figureChanges?.filter((change) => change.blockId !== block.id || change.before.path !== figure.path) ?? [], {
				blockId: block.id,
				before,
				after
			}];
			const id = previous?.id ?? `P${document.proposals.length + 1}`;
			if (previous) Object.assign(previous, candidate, {
				flags,
				figureChanges
			});
			else document.proposals.push({
				...candidate,
				id,
				flags,
				figureChanges,
				status: "pending",
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			const assets = [...document.current.figureAssets?.filter((asset) => asset.path !== before.path) ?? [], before];
			document.current.figureAssets = assets;
			for (const revision of document.revisions) if (revision.id === document.current.id) revision.figureAssets = assets;
			this.record(document, previous ? "revised" : "proposed", id);
			await atomicWrite(key, JSON.stringify(document));
			return {
				document,
				diskChanged: false
			};
		});
	}
	async locate(path) {
		if (!path || isAbsolute(path) || !/\.md$/i.test(path)) throw new Error("Choose a workspace-relative .md file");
		const source = await realpath(resolve(this.root, path));
		const normalized = relative(this.root, source);
		if (normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized) || normalized.split(sep).includes(".paper-review")) throw new Error("Manuscript must be inside the configured workspace");
		const info = await stat(source);
		if (!info.isFile() || info.size > this.maxBytes) throw new Error(`Manuscript must be a regular file no larger than ${this.maxBytes} bytes`);
		return {
			source,
			key: resolve(this.stateRoot, `${revisionId(normalized)}.json`),
			path: normalized
		};
	}
	async sourceText(source) {
		const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			if ((await file.stat()).size > this.maxBytes) throw new Error("Manuscript exceeds configured size limit");
			const bytes = await file.readFile();
			if (bytes.length > this.maxBytes) throw new Error("Manuscript exceeds configured size limit");
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} finally {
			await file.close();
		}
	}
	async bibSource(path) {
		if (!path || isAbsolute(path) || !/\.bib$/i.test(path) || path.split(/[\\/]/).some((part) => part === ".." || part === ".paper-review")) throw new Error("Choose a workspace-relative .bib file outside .paper-review");
		const source = await realpath(resolve(this.root, path));
		const normalized = relative(this.root, source);
		if (normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized) || normalized.split(sep).includes(".paper-review") || !(await stat(source)).isFile()) throw new Error("BibTeX file must remain inside the workspace");
		return source;
	}
	async bibText(source) {
		const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			if ((await file.stat()).size > this.maxBytes) throw new Error("BibTeX file exceeds configured size limit");
			const bytes = await file.readFile();
			if (bytes.length > this.maxBytes) throw new Error("BibTeX file exceeds configured size limit");
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} finally {
			await file.close();
		}
	}
	async bibBindings() {
		const stored = await readFile(resolve(this.stateRoot, "bibliographies.json"), "utf8").catch((error) => {
			if (missing(error)) return void 0;
			throw error;
		});
		return stored === void 0 ? {} : BibBindingsSchema.parse(JSON.parse(stored));
	}
	async bibEntries(path) {
		const files = (await this.bibBindings())[path] ?? [];
		const entries = [];
		const keys = /* @__PURE__ */ new Set();
		for (const file of files) {
			const source = await this.bibSource(file);
			for (const entry of parseBibtex(await this.bibText(source), file)) {
				if (keys.has(entry.key)) throw new Error(`Duplicate BibTeX key ${entry.key} in bound files`);
				keys.add(entry.key);
				entries.push(entry);
			}
		}
		return {
			files,
			entries
		};
	}
	/**
	* Bind explicit workspace `.bib` files without changing the manuscript or their content.
	* @param path - workspace-relative Markdown manuscript.
	* @param files - complete replacement list of workspace-relative BibTeX paths.
	* @returns the new bibliography index and citation diagnostics.
	*/
	configureBibliography(path, files) {
		return this.serial(async () => {
			const location = await this.locate(path);
			if (new Set(files).size !== files.length) throw new Error("A BibTeX file cannot be bound twice");
			const keys = /* @__PURE__ */ new Set();
			for (const file of files) {
				const source = await this.bibSource(file);
				for (const entry of parseBibtex(await this.bibText(source), file)) {
					if (keys.has(entry.key)) throw new Error(`Duplicate BibTeX key ${entry.key} in bound files`);
					keys.add(entry.key);
				}
			}
			const bindings = await this.bibBindings();
			bindings[location.path] = files;
			await atomicWrite(resolve(this.stateRoot, "bibliographies.json"), JSON.stringify(bindings));
			return this.bibliographyViewNow(location.path);
		});
	}
	async bibliographyViewNow(path) {
		const { document } = await this.load(path);
		const { files, entries } = await this.bibEntries(document.path);
		const keys = new Set(entries.map((entry) => entry.key));
		const blocks = reviewableBlocks(document.current.blocks);
		const citations = blocks.flatMap((block) => block.kind === "code" ? [] : citationsIn(block.text).flatMap((citation) => citation.keys));
		const missingKeys = [...new Set(citations.filter((key) => !keys.has(key)))];
		const possibleBareKeys = possibleBareCitationKeys(blocks.filter((block) => block.kind !== "code").map((block) => block.text).join("\n"), entries.map((entry) => entry.key));
		const citationStatus = files.length === 0 ? "unbound" : missingKeys.length > 0 ? "missing-keys" : possibleBareKeys.length > 0 ? "possible-legacy-keys" : citations.length > 0 ? "resolved" : "no-citations";
		return {
			files,
			entries: entries.map(({ key, type, file, hash, fields }) => ({
				key,
				type,
				file,
				hash,
				fields
			})),
			missingKeys,
			possibleBareKeys,
			canonicalCitationCount: citations.length,
			citationStatus
		};
	}
	/**
	* Read bound BibTeX metadata and unresolved manuscript citations without modifying either source.
	* @param path - workspace-relative Markdown manuscript.
	* @returns bibliography index and citation diagnostics.
	*/
	bibliography(path) {
		return this.serial(() => this.bibliographyViewNow(path));
	}
	/**
	* Read one exact BibTeX entry for optimistic, field-preserving replacement.
	* @param path - workspace-relative Markdown manuscript.
	* @param key - bound BibTeX citation key.
	* @returns exact entry and hash; metadata truth is not verified.
	*/
	bibliographyEntry(path, key) {
		return this.serial(async () => {
			const { path: normalized } = await this.locate(path);
			const entry = (await this.bibEntries(normalized)).entries.find((item) => item.key === key);
			if (!entry) throw new Error(`BibTeX key ${key} is not in the bound files`);
			return entry;
		});
	}
	/**
	* Add one BibTeX entry directly to its bound source file; no manuscript proposal is created.
	* @param path - workspace-relative Markdown manuscript.
	* @param file - bound workspace-relative BibTeX file.
	* @param raw - one complete BibTeX entry; publication facts require external verification.
	* @returns updated index and citation diagnostics after an atomic file replacement.
	*/
	addBibliographyEntry(path, file, raw) {
		return this.serial(async () => {
			const { path: normalized } = await this.locate(path);
			const existing = await this.bibEntries(normalized);
			if (!existing.files.includes(file)) throw new Error("Bind this .bib file to the manuscript before adding an entry");
			const parsed = parseBibtex(raw, file);
			if (parsed.length !== 1 || raw.trim() !== parsed[0]?.raw) throw new Error("Provide exactly one complete BibTeX entry");
			const entry = parsed[0];
			if (existing.entries.some((item) => item.key === entry.key)) throw new Error(`BibTeX key ${entry.key} already exists`);
			if (!entry.fields.author || !entry.fields.title || !entry.fields.year) throw new Error("BibTeX entry needs author, title and year");
			const source = await this.bibSource(file);
			const before = await this.bibText(source);
			const after = `${before.trimEnd()}\n\n${entry.raw}\n`;
			if (Buffer.byteLength(after) > this.maxBytes) throw new Error("BibTeX file would exceed configured size limit");
			if (await this.bibText(source) !== before) throw new Error("BibTeX file changed during update; reread it");
			await atomicWrite(source, after);
			return this.bibliographyViewNow(normalized);
		});
	}
	/**
	* Replace one exact entry in its bound `.bib` file; other entries retain their original bytes.
	* @param path - workspace-relative Markdown manuscript.
	* @param key - existing BibTeX key, which the replacement must retain.
	* @param expectedHash - hash returned by bibliographyEntry for conflict detection.
	* @param raw - replacement BibTeX entry; publication facts require external verification.
	* @returns updated index and citation diagnostics after an atomic file replacement.
	*/
	replaceBibliographyEntry(path, key, expectedHash, raw) {
		return this.serial(async () => {
			const { path: normalized } = await this.locate(path);
			const entry = (await this.bibEntries(normalized)).entries.find((item) => item.key === key);
			if (!entry || entry.hash !== expectedHash) throw new Error("BibTeX entry changed; reread it before replacing");
			const parsed = parseBibtex(raw, entry.file);
			if (parsed.length !== 1 || parsed[0]?.key !== key || raw.trim() !== parsed[0].raw) throw new Error("Replacement must be one complete entry with the same key");
			if (!parsed[0].fields.author || !parsed[0].fields.title || !parsed[0].fields.year) throw new Error("BibTeX entry needs author, title and year");
			const source = await this.bibSource(entry.file);
			const before = await this.bibText(source);
			if (before.split(entry.raw).length !== 2) throw new Error("BibTeX entry no longer occurs exactly once in its source");
			const after = before.replace(entry.raw, parsed[0].raw);
			if (Buffer.byteLength(after) > this.maxBytes) throw new Error("BibTeX file would exceed configured size limit");
			if (await this.bibText(source) !== before) throw new Error("BibTeX file changed during update; reread it");
			await atomicWrite(source, after);
			return this.bibliographyViewNow(normalized);
		});
	}
	async load(path) {
		const location = await this.locate(path);
		const disk = await this.sourceText(location.source);
		const journal = await readFile(`${location.key}.pending`, "utf8").catch((error) => {
			if (missing(error)) return void 0;
			throw error;
		});
		if (journal !== void 0) {
			const pending = JournalSchema.parse(JSON.parse(journal));
			if (pending.next.path !== location.path) throw new Error("Recovery journal targets a different manuscript");
			if (revisionId(disk) === pending.after) await atomicWrite(location.key, JSON.stringify(pending.next));
			else if (revisionId(disk) !== pending.before) throw new Error("An interrupted acceptance conflicts with external edits. Preserve the .pending file and reconcile the manuscript before continuing.");
			await unlink(`${location.key}.pending`);
		}
		const stored = await readFile(location.key, "utf8").catch((error) => {
			if (missing(error)) return void 0;
			throw error;
		});
		let document;
		if (stored !== void 0) {
			document = DocumentSchema.parse(JSON.parse(stored));
			if (document.path !== location.path || revisionId(document.current.text) !== document.current.id) throw new Error("Manuscript state failed integrity validation");
		} else {
			const current = parseRevision(disk);
			document = {
				schemaVersion: 1,
				path: location.path,
				current,
				revisions: [current],
				annotations: [],
				highlights: [],
				proposals: [],
				baselines: [],
				history: [],
				reading: {}
			};
			await atomicWrite(location.key, JSON.stringify(document));
		}
		return {
			document,
			...location,
			disk
		};
	}
	record(document, action, detail) {
		document.history.push({
			at: (/* @__PURE__ */ new Date()).toISOString(),
			action,
			detail
		});
	}
	assertRevision(document, revision) {
		if (document.current.id !== revision) throw new Error("The reader version is stale. Load the current version before applying this action.");
	}
	/**
	* Read a pinned revision and signal external changes without replacing the reading view.
	* @param path - workspace-relative Markdown source.
	* @returns state and external-change flag.
	*/
	read(path) {
		return this.serial(async () => {
			const { document, disk } = await this.load(path);
			return {
				document,
				diskChanged: revisionId(disk) !== document.current.id
			};
		});
	}
	/** Validate every candidate edit against its base, current source, annotations and locks; return review hints. */
	async proposalFlags(document, proposal) {
		const base = document.revisions.find((r) => r.id === proposal.baseRevision);
		if (base === void 0) throw new Error("Unknown base revision; use paper_read first");
		const editKeys = proposal.edits.map((edit) => edit.operation ? `${edit.blockId}:${edit.operation}:${edit.after}` : `${edit.blockId}:replace`);
		if (new Set(editKeys).size !== editKeys.length) throw new Error("A proposal cannot repeat an identical edit or replace one block twice");
		for (const annotationId of proposal.annotationIds) {
			const annotation = document.annotations.find((a) => a.id === annotationId);
			if (annotation === void 0 || annotation.anchor !== "attached") throw new Error("Referenced annotation is missing or needs manual location");
		}
		const bibliography = await this.bibEntries(document.path);
		const keys = bibliography.files.length ? new Set(bibliography.entries.map((entry) => entry.key)) : null;
		for (const edit of proposal.edits) {
			const block = base.blocks.find((b) => b.id === edit.blockId);
			if (block === void 0) throw new Error(`Block ${edit.blockId} was not found in the base revision. Read it again with paper_read; deletion uses exact before text and empty after.`);
			if (block.text !== edit.before) {
				let at = 0;
				while (at < Math.min(block.text.length, edit.before.length) && block.text[at] === edit.before[at]) at++;
				const excerpt = (value) => JSON.stringify(value.slice(Math.max(0, at - 24), at + 48));
				throw new Error(`Block ${edit.blockId}: before differs from saved Markdown at character ${at + 1}. Expected ${excerpt(block.text)}; received ${excerpt(edit.before)}. Copy exact source from paper_read, including table punctuation and math delimiters. Empty after is allowed for deletion.`);
			}
			if (document.current.blocks.find((b) => b.id === edit.blockId)?.text !== edit.before) throw new Error("The proposed block has changed; reread it");
			if (document.baselines.some((b) => !b.archivedAt && b.blockId === edit.blockId && b.locked)) throw new Error("The author locked this block; ask them to unlock it");
			if (edit.operation) {
				assertStandaloneFragment(edit.after);
				assertNewCitations("", citationSource(edit.after), keys);
			} else {
				if (edit.before === edit.after) throw new Error("Replacement must contain an actual change");
				if (edit.after !== "") assertStandaloneFragment(edit.after);
				assertNewCitations(citationSource(edit.before), citationSource(edit.after), keys);
			}
		}
		return checkChanges(proposal, base.blocks);
	}
	/**
	* Submit validated Markdown replacements, deletions or insertions without writing the manuscript.
	* @param path - manuscript.
	* @param input - exact base and edits.
	* @returns stored proposal id and checks.
	*/
	propose(path, input) {
		return this.serial(async () => {
			const proposal = normalizeBlockInsertions(ProposalInputSchema.parse(input));
			const { document, key, disk } = await this.load(path);
			if (revisionId(disk) !== document.current.id) throw new Error("External changes await reader refresh; no proposal can be submitted against stale source");
			const flags = await this.proposalFlags(document, proposal);
			const id = `P${document.proposals.length + 1}`;
			document.proposals.push({
				...proposal,
				id,
				status: "pending",
				flags,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			this.record(document, "proposed", id);
			await atomicWrite(key, JSON.stringify(document));
			return {
				document,
				diskChanged: false
			};
		});
	}
	/**
	* Revise one pending proposal in place, without writing the manuscript or changing its id.
	* Omitted fields retain their prior values; a supplied edits array replaces the whole edit group.
	* An explicit baseRevision lets a stale proposal be rebased onto exact blocks in a newer reader version.
	* @param path - manuscript.
	* @param input - current reader revision, proposal id, and changed proposal fields.
	* @returns updated review state after the same checks used for a new proposal.
	*/
	revise(path, input) {
		return this.serial(async () => {
			const revision = ProposalRevisionInputSchema.parse(input);
			const { document, key, disk } = await this.load(path);
			this.assertRevision(document, revision.revision);
			if (revisionId(disk) !== document.current.id) throw new Error("External changes await reader refresh; no proposal can be revised against stale source");
			const previous = document.proposals.find((p) => p.id === revision.proposalId);
			if (!previous || previous.status !== "pending") throw new Error("Proposal is no longer pending");
			const candidate = normalizeBlockInsertions(ProposalInputSchema.parse({
				baseRevision: revision.baseRevision ?? previous.baseRevision,
				annotationIds: revision.annotationIds ?? previous.annotationIds,
				reason: revision.reason ?? previous.reason,
				meaning: revision.meaning ?? previous.meaning,
				edits: revision.edits ?? previous.edits
			}));
			if (candidate.baseRevision === previous.baseRevision && candidate.reason === previous.reason && candidate.meaning === previous.meaning && JSON.stringify(candidate.annotationIds) === JSON.stringify(previous.annotationIds) && JSON.stringify(candidate.edits) === JSON.stringify(previous.edits)) throw new Error("Proposal revision makes no changes");
			const flags = await this.proposalFlags(document, candidate);
			Object.assign(previous, candidate, { flags });
			if (revision.edits) previous.figureChanges = previous.figureChanges?.filter((change) => candidate.edits.some((edit) => edit.blockId === change.blockId && collectFigures([{
				id: edit.blockId,
				text: edit.after,
				kind: "paragraph",
				section: "",
				start: 0,
				end: edit.after.length
			}]).some((figure) => figure.path === change.after.path)));
			this.record(document, "revised", previous.id);
			await atomicWrite(key, JSON.stringify(document));
			return {
				document,
				diskChanged: false
			};
		});
	}
	/**
	* Propose whole-block deletion using a source hash; Markdown never needs to be retyped by the model.
	* Existing groups retain their other edits and metadata; changed or locked source is still rejected.
	* @param path - manuscript.
	* @param input - current revision, exact block and hash returned by paper_read.
	* @returns pending proposal; manuscript bytes are unchanged.
	*/
	proposeDeletion(path, input) {
		return this.serial(async () => {
			const deletion = DeletionInputSchema.parse(input);
			const { document, key, disk } = await this.load(path);
			this.assertRevision(document, deletion.baseRevision);
			if (revisionId(disk) !== document.current.id) throw new Error("External changes await reader refresh; reread before proposing deletion");
			const block = document.current.blocks.find((item) => item.id === deletion.blockId);
			if (!block || revisionId(block.text) !== deletion.beforeHash) throw new Error("Deletion source hash does not match; use paper_read with blockId again");
			const previous = deletion.proposalId ? document.proposals.find((item) => item.id === deletion.proposalId && item.status === "pending") : void 0;
			if (deletion.proposalId && !previous) throw new Error("Proposal is no longer pending");
			if (previous && previous.baseRevision !== deletion.baseRevision) throw new Error("Rebase the pending proposal with paper_revise before appending deletion");
			if (previous?.edits.some((edit) => edit.blockId === block.id)) throw new Error("This proposal already edits the block; revise the existing edit rather than appending a conflicting deletion");
			const edit = {
				blockId: block.id,
				before: block.text,
				after: ""
			};
			const candidate = ProposalInputSchema.parse({
				baseRevision: deletion.baseRevision,
				annotationIds: previous?.annotationIds ?? [],
				meaning: previous?.meaning ?? "structure",
				reason: previous ? `${previous.reason}\n\n${deletion.reason}` : deletion.reason,
				edits: [...previous?.edits ?? [], edit]
			});
			const flags = await this.proposalFlags(document, candidate);
			const id = previous?.id ?? `P${document.proposals.length + 1}`;
			if (previous) Object.assign(previous, candidate, { flags });
			else document.proposals.push({
				...candidate,
				id,
				status: "pending",
				flags,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			this.record(document, previous ? "revised" : "proposed", id);
			await atomicWrite(key, JSON.stringify(document));
			return {
				document,
				diskChanged: false
			};
		});
	}
	/**
	* Apply an authenticated operator gesture. Acceptance checks current source and preserves a recovery journal.
	* @param command - validated browser action.
	* @returns updated state.
	*/
	command(command) {
		return this.serial(async () => {
			const { document, key, source, disk } = await this.load(command.path);
			if (command.action === "open") return {
				document,
				diskChanged: revisionId(disk) !== document.current.id
			};
			if ("revision" in command) this.assertRevision(document, command.revision);
			let output;
			switch (command.action) {
				case "refresh":
					if (revisionId(disk) !== document.current.id) {
						document.current = parseRevision(disk, document.current);
						document.revisions.push(document.current);
						document.annotations = migrateAnnotations(document.annotations, document.current);
						document.highlights = migrateAnnotations(document.highlights, document.current);
						this.record(document, "imported", document.current.id);
					}
					break;
				case "annotate": {
					const block = document.current.blocks.find((b) => b.id === command.blockId);
					if (!block || !command.rendered && command.quote !== "" && !block.text.includes(command.quote)) throw new Error("Selection does not match Markdown source; annotate the entire paragraph or select its source text");
					const id = `C${document.annotations.length + 1}`;
					document.annotations.push({
						id,
						blockId: block.id,
						revision: document.current.id,
						quote: command.quote,
						prefix: command.prefix,
						suffix: command.suffix,
						comment: command.comment,
						status: "open",
						anchor: "attached",
						...command.rendered ? {
							renderedSource: block.text,
							offset: command.offset
						} : {}
					});
					this.record(document, "annotated", id);
					break;
				}
				case "highlight": {
					const block = document.current.blocks.find((b) => b.id === command.blockId);
					if (!block) throw new Error("The selected paragraph no longer exists");
					const existing = document.highlights.find((h) => !h.removed && h.anchor === "attached" && h.blockId === block.id && h.quote === command.quote && h.offset === command.offset && h.prefix === command.prefix && h.suffix === command.suffix);
					if (existing) existing.color = command.color;
					else document.highlights.push({
						id: `H${document.highlights.length + 1}`,
						blockId: block.id,
						revision: document.current.id,
						quote: command.quote,
						prefix: command.prefix,
						suffix: command.suffix,
						renderedSource: block.text,
						offset: command.offset,
						color: command.color,
						anchor: "attached",
						removed: false
					});
					this.record(document, "highlighted", existing?.id ?? `H${document.highlights.length}`);
					break;
				}
				case "set-highlight": {
					const highlight = document.highlights.find((h) => h.id === command.highlightId);
					if (!highlight) throw new Error("Highlight not found");
					highlight.removed = command.removed;
					this.record(document, command.removed ? "highlight-removed" : "highlight-restored", highlight.id);
					break;
				}
				case "resolve": {
					const annotation = document.annotations.find((a) => a.id === command.annotationId);
					if (!annotation) throw new Error("Annotation not found");
					annotation.status = command.resolved ? "resolved" : "open";
					this.record(document, command.resolved ? "resolved" : "reopened", annotation.id);
					break;
				}
				case "review":
					if (revisionId(disk) !== document.current.id) throw new Error("External changes must be loaded before marking the current text reviewed");
					for (const blockId of command.blockIds) {
						const block = document.current.blocks.find((b) => b.id === blockId);
						if (!block) throw new Error("Block no longer exists");
						const locked = command.locked || document.baselines.some((b) => !b.archivedAt && b.blockId === blockId && b.locked);
						document.baselines = document.baselines.filter((b) => b.archivedAt || b.blockId !== blockId);
						document.baselines.push({
							blockId,
							revision: document.current.id,
							text: block.text,
							locked,
							reviewedAt: (/* @__PURE__ */ new Date()).toISOString()
						});
					}
					this.record(document, command.locked ? "reviewed-and-locked" : "reviewed", command.blockIds.join(", "));
					break;
				case "decide": {
					const proposal = document.proposals.find((p) => p.id === command.proposalId);
					if (!proposal || proposal.status !== "pending") throw new Error("Proposal is no longer pending");
					if (command.accept) {
						if (revisionId(disk) !== document.current.id) throw new Error("Source changed outside paper review; acceptance was refused");
						const figureDirectory = authoredFigureBase(document.current.text) || document.path.slice(0, Math.max(0, document.path.lastIndexOf("/")));
						for (const change of proposal.figureChanges ?? []) for (const asset of [change.before, change.after]) {
							const file = figureFilePath(document.path, figureDirectory, asset.snapshot);
							if (!file || createHash("sha256").update(await this.figureData(file)).digest("hex") !== asset.hash) throw new Error("Retained figure bytes changed; regenerate the figure proposal before accepting it");
						}
						const changes = proposal.edits.map((edit) => {
							const block = document.current.blocks.find((b) => b.id === edit.blockId);
							if (!block || block.text !== edit.before) throw new Error("This proposal overlaps an accepted or external edit. Ask for a new proposal.");
							if (document.baselines.some((b) => !b.archivedAt && b.blockId === edit.blockId && b.locked)) throw new Error("Unlock the reviewed block before accepting a change");
							return {
								block,
								edit
							};
						});
						const bibliography = await this.bibEntries(document.path);
						const keys = bibliography.files.length ? new Set(bibliography.entries.map((entry) => entry.key)) : null;
						for (const { edit } of changes) assertNewCitations(edit.operation ? "" : citationSource(edit.before), citationSource(edit.after), keys);
						const sourceText = document.current.text;
						output = sourceText;
						const blocks = document.current.blocks;
						const newline = sourceText.includes("\r\n") ? "\r\n" : "\n";
						const separator = newline + newline;
						const operations = changes.map(({ block, edit }, index) => {
							if (!edit.operation) return {
								start: block.start,
								end: block.end,
								content: edit.after,
								index
							};
							const anchorIndex = blocks.findIndex((candidate) => candidate.id === block.id);
							const adjacent = edit.operation === "insert-before" ? blocks[anchorIndex - 1] : blocks[anchorIndex + 1];
							const gap = edit.operation === "insert-before" ? sourceText.slice(adjacent?.end ?? block.start, block.start) : sourceText.slice(block.end, adjacent?.start ?? block.end);
							const missingBreaks = adjacent ? newline.repeat(Math.max(0, 2 - (gap.match(/\r?\n/g)?.length ?? 0))) : "";
							return edit.operation === "insert-before" ? {
								start: block.start,
								end: block.start,
								content: missingBreaks + edit.after + separator,
								index
							} : {
								start: block.end,
								end: block.end,
								content: separator + edit.after + missingBreaks,
								index
							};
						});
						for (const operation of operations.sort((a, b) => b.start - a.start || b.end - a.end || b.index - a.index)) output = output.slice(0, operation.start) + operation.content + output.slice(operation.end);
						if (Buffer.byteLength(output) > this.maxBytes) throw new Error("Accepted manuscript would exceed configured size limit");
						const replacements = new Map(proposal.edits.filter((edit) => !edit.operation).map((edit) => [edit.blockId, edit.after]));
						document.current = parseRevision(output, document.current, replacements);
						document.revisions.push(document.current);
						document.annotations = migrateAnnotations(document.annotations, document.current);
						document.highlights = migrateAnnotations(document.highlights, document.current);
					}
					proposal.status = command.accept ? "accepted" : "rejected";
					this.record(document, proposal.status, proposal.id);
					break;
				}
				case "position":
					document.reading[command.reader] = command.blockId;
					break;
				case "archive-baseline":
				case "restore-baseline":
				case "relink-baseline": {
					if (revisionId(disk) !== document.current.id) throw new Error("Load external changes before recovering a review record");
					const restoring = command.action === "restore-baseline";
					const baseline = document.baselines.find((b) => b.blockId === command.blockId && (command.action === "restore-baseline" ? b.archivedAt === command.archivedAt : !b.archivedAt));
					if (!baseline) throw new Error("Review record no longer matches this recovery action");
					if (restoring) {
						if (document.baselines.some((b) => b.blockId === baseline.blockId && !b.archivedAt)) throw new Error("An active review record already exists for this paragraph");
						delete baseline.archivedAt;
					} else {
						if (document.current.blocks.some((b) => b.id === baseline.blockId)) throw new Error("Only a missing paragraph review record can be archived or reassociated");
						if (command.action === "relink-baseline") {
							const target = document.current.blocks.find((b) => b.id === command.targetBlockId);
							if (!target) throw new Error("The chosen paragraph no longer exists");
							if (document.baselines.some((b) => !b.archivedAt && b.blockId === target.id)) throw new Error("The chosen paragraph already has an active review record");
							document.baselines.push({
								...baseline,
								blockId: target.id
							});
						}
						baseline.archivedAt = (/* @__PURE__ */ new Date()).toISOString();
					}
					this.record(document, command.action, command.action === "relink-baseline" ? `${command.blockId} -> ${command.targetBlockId}` : command.blockId);
					break;
				}
				case "unlock": {
					const baseline = document.baselines.find((b) => !b.archivedAt && b.blockId === command.blockId);
					if (!baseline) throw new Error("No review baseline exists for this block");
					baseline.locked = false;
					this.record(document, "unlocked", command.blockId);
					break;
				}
			}
			if (output !== void 0) {
				await atomicWrite(`${key}.pending`, JSON.stringify({
					before: revisionId(disk),
					after: revisionId(output),
					next: document
				}));
				if (await this.sourceText(source) !== disk) {
					await unlink(`${key}.pending`);
					throw new Error("Source changed during acceptance; retry after importing the new version");
				}
				await atomicWrite(source, output);
				await atomicWrite(key, JSON.stringify(document));
				await unlink(`${key}.pending`);
			} else await atomicWrite(key, JSON.stringify(document));
			return {
				document,
				diskChanged: revisionId(output ?? disk) !== document.current.id
			};
		});
	}
};
//#endregion
//#region lib/types/native-file-picker.js
/** Host-side macOS manuscript chooser; the caller validates the returned path. */
const SCRIPT = `on run argv
  set selectedFile to choose file with prompt "Choose Markdown manuscript" of type {"md"} default location (POSIX file (item 1 of argv))
  return POSIX path of selectedFile
end run`;
const BIB_SCRIPT = `on run argv
  set selectedFile to choose file with prompt "Choose authoritative BibTeX file" of type {"bib"} default location (POSIX file (item 1 of argv))
  return POSIX path of selectedFile
end run`;
const FIGURE_SCRIPT = `on run argv
  set initialLocation to POSIX file (item 1 of argv)
  tell application "Finder"
    activate
    set selectedFile to choose file with prompt "Choose replacement figure" of type {"pdf", "png", "jpg", "jpeg", "webp", "gif", "svg"} default location initialLocation
  end tell
  return POSIX path of selectedFile
end run`;
/**
* Choose a replacement PDF or image on the macOS host; the caller validates workspace access.
* @param workspaceRoot - initial Finder directory.
* @param signal - request lifetime.
* @param run - native command adapter.
* @param platform - host platform.
* @returns absolute selected path, or null when canceled.
*/
async function pickNativeFigure(workspaceRoot, signal, run = runNativeCommand, platform = process.platform) {
	if (platform !== "darwin") throw new Error("Native figure selection requires macOS on the DSH host");
	try {
		const { stdout } = await run("osascript", [
			"-e",
			FIGURE_SCRIPT,
			workspaceRoot
		], signal);
		const path = stdout.replace(/[\r\n]+$/, "");
		if (!path) throw new Error("Finder returned no figure path");
		return path;
	} catch (error) {
		if (!signal.aborted && typeof error === "object" && error !== null && "code" in error && error.code === 1 && "stderr" in error && typeof error.stderr === "string" && /(?:User canceled|-128)/i.test(error.stderr)) return null;
		throw new Error("Finder could not open the figure file chooser", { cause: error });
	}
}
/**
* Show the host's Finder file chooser when an operator is at its display.
* @param workspaceRoot - initial chooser directory, not a file authorization.
* @param signal - request lifetime; abort terminates the native command.
* @param run - command adapter for deterministic tests.
* @param platform - host platform for deterministic tests.
* @returns selected absolute path, or null after cancellation.
*/
async function pickNativeManuscript(workspaceRoot, signal, run = runNativeCommand, platform = process.platform) {
	if (platform !== "darwin") throw new Error("Native manuscript selection requires macOS on the DSH host");
	try {
		const { stdout } = await run("osascript", [
			"-e",
			SCRIPT,
			workspaceRoot
		], signal);
		const path = stdout.replace(/[\r\n]+$/, "");
		if (!path) throw new Error("Finder returned no manuscript path");
		return path;
	} catch (error) {
		if (!signal.aborted && typeof error === "object" && error !== null && "code" in error && error.code === 1 && "stderr" in error && typeof error.stderr === "string" && /(?:User canceled|-128)/i.test(error.stderr)) return null;
		throw new Error("Finder could not open the Markdown file chooser", { cause: error });
	}
}
/**
* Choose one existing `.bib` file on the macOS DSH host; the caller confines its path.
* @param workspaceRoot - initial Finder directory.
* @param signal - request lifetime; abort terminates the native command.
* @param run - command adapter for tests.
* @param platform - host platform for tests.
* @returns selected absolute path, or null after cancellation.
*/
async function pickNativeBibliography(workspaceRoot, signal, run = runNativeCommand, platform = process.platform) {
	if (platform !== "darwin") throw new Error("Native bibliography selection requires macOS on the DSH host");
	try {
		const { stdout } = await run("osascript", [
			"-e",
			BIB_SCRIPT,
			workspaceRoot
		], signal);
		const path = stdout.replace(/[\r\n]+$/, "");
		if (!path) throw new Error("Finder returned no BibTeX path");
		return path;
	} catch (error) {
		if (!signal.aborted && typeof error === "object" && error !== null && "code" in error && error.code === 1 && "stderr" in error && typeof error.stderr === "string" && /(?:User canceled|-128)/i.test(error.stderr)) return null;
		throw new Error("Finder could not open the BibTeX file chooser", { cause: error });
	}
}
//#endregion
//#region lib/types/index.js
/** Cordis plugin identity. */
const name = "paper-review";
/** The plugin requires authenticated transport and the model tool executor. */
const inject = [
	"connection",
	"tools",
	"agents",
	"sessions"
];
/** Loader validation; workspace selection is explicit. */
const Config = ConfigSchema.object({
	workspaceRoot: ConfigSchema.string(),
	maxBytes: ConfigSchema.natural().min(1).max(2e6).default(1e6),
	maxFigureBytes: ConfigSchema.natural().min(1).default(67108864)
});
/** Manuscript tools visible after a document opens; ordinary tools remain available. */
const PAPER_TOOLS = [
	"paper_read",
	"paper_annotations",
	"paper_propose",
	"paper_revise",
	"paper_delete",
	"paper_check",
	"paper_decide",
	"paper_bib_find",
	"paper_bib_bind",
	"paper_bib_list",
	"paper_bib_get",
	"paper_bib_add",
	"paper_bib_replace",
	"paper_figure_list",
	"paper_figure_replace"
];
/** Manuscript discovery tools are available before a document opens. */
const PAPER_DISCOVERY_TOOLS = ["paper_list", "paper_open"];
/** Omit absent operation fields from model-visible JSON while retaining legacy replacement records. */
function modelProposal(proposal) {
	const { figureChanges, ...rest } = proposal;
	return {
		...rest,
		...figureChanges ? { figureChanges } : {},
		edits: proposal.edits.map(({ operation, ...edit }) => operation ? {
			...edit,
			operation
		} : edit)
	};
}
/**
* Register the workspace store, tools and authenticated operator RPC.
* @param ctx - Host plugin context.
* @param config - validated local project settings.
*/
async function apply(ctx, config) {
	const stores = /* @__PURE__ */ new Map();
	const enabled = /* @__PURE__ */ new Set();
	const scopes = /* @__PURE__ */ new Map();
	const rootFor = async (sessionId) => {
		const header = ctx.sessions.get(sessionId)?.header ?? (await ctx.get("sessionPersistence")?.stat(sessionId))?.header;
		if (!header) throw new Error("This conversation no longer exists. Open a local conversation before opening a manuscript");
		const root = config.workspaceRoot ?? header.cwd;
		if (!root) throw new Error("Select a local workspace for this conversation first");
		return root;
	};
	const storeFor = async (sessionId) => {
		const root = await realpath(await rootFor(sessionId));
		let pending = stores.get(root);
		if (!pending) {
			pending = (async () => {
				const store = new PaperStore(root, config.maxBytes, config.maxFigureBytes);
				await store.start();
				return store;
			})();
			stores.set(root, pending);
			pending.catch(() => {
				if (stores.get(root) === pending) stores.delete(root);
			});
		}
		return pending;
	};
	const modelStore = (agent) => {
		if (!agent || !enabled.has(agent.id)) throw new Error("Open a manuscript with paper_open or in the Paper review panel first");
		return storeFor(agent.id);
	};
	ctx.effect(() => async () => {
		for (const dispose of scopes.values()) dispose();
		scopes.clear();
		await Promise.all([...stores.values()].map(async (pending) => {
			await (await pending).close();
		}));
	});
	ctx.effect(() => ctx.tools.guard((exec) => PAPER_TOOLS.some((tool) => tool === exec.name) && (!exec.agent || !enabled.has(exec.agent.id)) ? "Open a manuscript with paper_open or in the Paper review panel first." : void 0));
	const pathParameter = {
		type: "string",
		required: true,
		description: "Workspace-relative Markdown manuscript path, for example article.md."
	};
	const output = {
		schema: { type: "json" },
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value)
		}]
	};
	const enable = async (sessionId, store, allowRunning) => {
		if (enabled.has(sessionId)) return;
		const agent = ctx.agents.get(sessionId);
		if (!allowRunning && agent?.status === "running") throw new Error("Wait for the current response to finish before enabling Paper review");
		enabled.add(sessionId);
		try {
			if (agent) scopeAgent(agent);
			await store.enableSession(sessionId);
		} catch (error) {
			enabled.delete(sessionId);
			if (agent) scopeAgent(agent);
			throw error;
		}
	};
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_list",
		description: "List Markdown manuscripts and folders in the conversation workspace. Use this to find a manuscript before paper_open; it does not open a Finder dialog.",
		parameters: { path: {
			type: "string",
			description: "Workspace-relative directory; omit for the workspace root."
		} },
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			if (!exec.agent) throw new Error("A conversation is required");
			return (await storeFor(exec.agent.id)).listFiles(args.path ?? "");
		},
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: "List manuscripts"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_open",
		description: "Open a workspace-relative Markdown manuscript in this conversation. Use paper_list to find it. This enables Paper review tools without removing ordinary agent tools.",
		parameters: { path: pathParameter },
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			if (!exec.agent) throw new Error("A conversation is required");
			const store = await storeFor(exec.agent.id);
			const { document, diskChanged } = await store.read(args.path);
			await enable(exec.agent.id, store, true);
			await store.selectPath(exec.agent.id, document.path);
			return {
				path: document.path,
				revision: document.current.id,
				blocks: document.current.blocks.length,
				diskChanged
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: "Open manuscript"
		})
	})));
	for (const toolName of [
		"paper_read",
		"paper_annotations",
		"paper_check"
	]) ctx.effect(() => ctx.tools.register(defineTool({
		name: toolName,
		description: toolName === "paper_read" ? "Read manuscript blocks and their exact ids and revision. Optionally read one block plus its neighbors; a selected block also returns beforeHash for paper_delete, so LaTeX or table Markdown need not be retyped. Preserve scientific claims; never strengthen causality, generalizability, novelty, significance or superiority without explicit author instruction." : toolName === "paper_annotations" ? "Read author annotations and their exact quotations. Detached annotations require the author to locate them again." : "Check pending proposals against current text, author locks and external source changes. Pass proposalId to read one pending proposal in full before revising it. Mechanical flags are review hints, not scientific verification.",
		parameters: toolName === "paper_check" ? {
			path: pathParameter,
			proposalId: {
				type: "string",
				description: "Optional pending proposal id whose full content should be returned."
			}
		} : {
			path: pathParameter,
			blockId: {
				type: "string",
				description: "Optional exact block id returned by paper_read."
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			const { document, diskChanged } = await (await modelStore(exec.agent)).read(args.path);
			if (toolName === "paper_annotations") return {
				revision: document.current.id,
				annotations: document.annotations.map(({ id, blockId, revision, quote, prefix, suffix, comment, status, anchor }) => ({
					id,
					blockId,
					revision,
					quote,
					prefix,
					suffix,
					comment,
					status,
					anchor
				})),
				diskChanged
			};
			if (toolName === "paper_check") {
				const selected = args.proposalId === void 0 ? void 0 : document.proposals.find((p) => p.id === args.proposalId && p.status === "pending");
				if (args.proposalId !== void 0 && !selected) throw new Error("Pending proposal not found");
				return {
					revision: document.current.id,
					diskChanged,
					...selected ? { proposal: modelProposal(selected) } : {},
					proposals: document.proposals.filter((p) => p.status === "pending").map((p) => ({
						id: p.id,
						flags: p.flags,
						authorDeclaredMeaning: p.meaning,
						applicable: !diskChanged && p.edits.every((e) => document.current.blocks.some((b) => b.id === e.blockId && b.text === e.before) && !document.baselines.some((b) => !b.archivedAt && b.blockId === e.blockId && b.locked))
					}))
				};
			}
			const index = args.blockId === void 0 ? -1 : document.current.blocks.findIndex((b) => b.id === args.blockId);
			if (args.blockId !== void 0 && index === -1) throw new Error("Block no longer exists; reread the manuscript");
			const selectedBlock = document.current.blocks[index];
			return {
				path: document.path,
				revision: document.current.id,
				diskChanged,
				blocks: index === -1 ? document.current.blocks : document.current.blocks.slice(Math.max(0, index - 1), index + 2),
				...selectedBlock ? { beforeHash: revisionId(selectedBlock.text) } : {},
				lockedBlockIds: document.baselines.filter((b) => !b.archivedAt && b.locked).map((b) => b.blockId)
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: toolName
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_figure_list",
		description: "List the exact local figures referenced by the current manuscript, with block ids, authored paths, workspace files and retained hashes. Read-only; missing files are not replaced by guessed versions.",
		parameters: { path: pathParameter },
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			return (await modelStore(exec.agent)).listFigures(args.path);
		},
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: "List manuscript figures"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_figure_replace",
		description: "Propose replacing one referenced figure with an existing workspace PDF or image. Use paper_figure_list and paper_read for the current revision, blockId and authored figure path. Retains content-hashed copies of both files and changes only the figure destination, not caption prose. The manuscript and original files stay unchanged until paper_decide accepts. Supply proposalId to revise a pending proposal in place. Inspect old/new previews and caption/panel consistency before accepting; never overwrite the old image in place.",
		parameters: {
			path: pathParameter,
			revision: {
				type: "string",
				required: true,
				description: "Current manuscript revision."
			},
			blockId: {
				type: "string",
				required: true,
				description: "Exact figure block id."
			},
			figure: {
				type: "string",
				required: true,
				description: "Authored figure destination returned by paper_figure_list."
			},
			replacement: {
				type: "string",
				required: true,
				description: "Existing workspace-relative replacement file; it may be outside the manuscript figure directory."
			},
			reason: {
				type: "string",
				required: true,
				description: "Why the figure should be replaced; mention panel/caption changes requiring separate review."
			},
			proposalId: {
				type: "string",
				description: "Pending proposal to revise instead of creating another."
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			const view = await (await modelStore(exec.agent)).replaceFigure(args.path, FigureReplacementSchema.parse(args));
			const proposal = view.document.proposals.find((candidate) => candidate.id === args.proposalId) ?? view.document.proposals.at(-1);
			if (!proposal) throw new Error("Figure replacement produced no proposal");
			return {
				proposal: modelProposal(proposal),
				manuscriptWritten: false,
				originalFilesWritten: false
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Propose figure replacement"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_propose",
		description: "Submit a manuscript change for author review without writing the source. Copy blockId and exact before text from paper_read. With operation: insert-before/insert-after, after may contain any complete Markdown fragment, including lists, tables, headings, quotes, code and multiple blocks. Without operation, after replaces the selected block; an empty string proposes deletion. For compatibility, an unchanged before block followed or preceded by blank-separated new blocks is treated as insertion. Group dependent edits. Unchanged anchors remain valid after unrelated revisions; reread changed or missing anchors. Version, locks and bound citation keys are checked; lexical flags are review hints, not scientific approval.",
		parameters: {
			path: pathParameter,
			baseRevision: {
				type: "string",
				required: true
			},
			annotationIds: {
				type: "array",
				items: { type: "string" },
				required: true
			},
			reason: {
				type: "string",
				required: true
			},
			meaning: {
				type: "string",
				enum: [
					"style",
					"structure",
					"claim",
					"evidence"
				],
				required: true
			},
			edits: {
				type: "array",
				required: true,
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						blockId: {
							type: "string",
							required: true
						},
						before: {
							type: "string",
							required: true
						},
						after: {
							type: "string",
							required: true
						},
						operation: {
							type: "string",
							enum: ["insert-before", "insert-after"],
							description: "Insert complete Markdown blocks beside the exact before anchor. Omit to replace the block; set after to empty to propose deletion."
						}
					}
				}
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			const proposal = (await (await modelStore(exec.agent)).propose(args.path, ProposalInputSchema.parse(args))).document.proposals.at(-1);
			if (!proposal) throw new Error("Submitted proposal was not retained");
			return {
				id: proposal.id,
				status: proposal.status,
				flags: proposal.flags,
				manuscriptWritten: false
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Propose manuscript changes"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_revise",
		description: "Revise an existing pending manuscript proposal in place; keep its id and do not write the manuscript. Inspect it with paper_check and read current source with paper_read. Supplied edits replace the complete edit group. Use operation to insert any complete Markdown fragment beside an exact anchor; omit operation to replace a block with any complete Markdown fragment or delete it with empty after. An unchanged anchor beside blank-separated new blocks is also treated as insertion. Rebase stale proposals with the current baseRevision, block ids and exact before text. Version, annotation, lock and citation checks run again. Settled proposals cannot be revised.",
		parameters: {
			path: pathParameter,
			proposalId: {
				type: "string",
				required: true,
				description: "Id of the pending proposal to revise."
			},
			revision: {
				type: "string",
				required: true,
				description: "Current manuscript revision returned by paper_read or paper_check."
			},
			baseRevision: {
				type: "string",
				description: "Optional new source revision for rebasing a stale proposal; pair with complete current-source edits."
			},
			annotationIds: {
				type: "array",
				items: { type: "string" },
				description: "Optional full replacement list of attached annotation ids."
			},
			reason: {
				type: "string",
				description: "Optional revised reason for the whole proposal."
			},
			meaning: {
				type: "string",
				enum: [
					"style",
					"structure",
					"claim",
					"evidence"
				],
				description: "Optional revised author-facing change category."
			},
			edits: {
				type: "array",
				description: "Optional full replacement edit group; omit to keep all existing edits.",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						blockId: {
							type: "string",
							required: true
						},
						before: {
							type: "string",
							required: true
						},
						after: {
							type: "string",
							required: true
						},
						operation: {
							type: "string",
							enum: ["insert-before", "insert-after"],
							description: "Insert complete Markdown blocks beside the exact before anchor. Omit to replace the block; set after to empty to propose deletion."
						}
					}
				}
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			const proposal = (await (await modelStore(exec.agent)).revise(args.path, ProposalRevisionInputSchema.parse(args))).document.proposals.find((p) => p.id === args.proposalId);
			if (!proposal) throw new Error("Revised proposal was not retained");
			return {
				proposal: modelProposal(proposal),
				manuscriptWritten: false
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Revise manuscript proposal"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_delete",
		description: "Propose deleting one complete Markdown block without retyping its source (useful for tables or LaTeX). First call paper_read with blockId and copy its revision and beforeHash. Supply proposalId to append deletion to an existing pending group while preserving all its other edits. A block already edited by that group must instead be changed with paper_revise. This only creates or revises a pending proposal; only author-requested paper_decide acceptance writes the manuscript. To delete part of a paragraph, use paper_propose/paper_revise with the complete exact before and the remaining after text.",
		parameters: {
			path: pathParameter,
			baseRevision: {
				type: "string",
				required: true
			},
			blockId: {
				type: "string",
				required: true
			},
			beforeHash: {
				type: "string",
				required: true,
				description: "Exact beforeHash returned by paper_read with this blockId."
			},
			reason: {
				type: "string",
				required: true
			},
			proposalId: {
				type: "string",
				description: "Optional pending group to append to, without replacing its existing edits."
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			const view = await (await modelStore(exec.agent)).proposeDeletion(args.path, args);
			const proposal = args.proposalId ? view.document.proposals.find((item) => item.id === args.proposalId) : view.document.proposals.at(-1);
			if (!proposal) throw new Error("Deletion proposal was not retained");
			return {
				proposal: modelProposal(proposal),
				manuscriptWritten: false
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Propose block deletion"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_decide",
		description: "Accept or reject one pending proposal. Accept writes the manuscript after revision, source and lock checks; reject changes only review metadata. Accept only when the user requests it. Use paper_check first and never claim this is scientific verification.",
		parameters: {
			path: pathParameter,
			revision: {
				type: "string",
				required: true
			},
			proposalId: {
				type: "string",
				required: true
			},
			decision: {
				type: "string",
				enum: ["accept", "reject"],
				required: true
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			const view = await (await modelStore(exec.agent)).command({
				action: "decide",
				path: args.path,
				revision: args.revision,
				proposalId: args.proposalId,
				accept: args.decision === "accept"
			});
			return {
				proposalId: args.proposalId,
				status: args.decision === "accept" ? "accepted" : "rejected",
				revision: view.document.current.id,
				manuscriptWritten: args.decision === "accept"
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Decide manuscript proposal"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_bib_find",
		description: "List workspace folders and .bib files one directory at a time. Read-only; use this to locate authoritative BibTeX files before binding them to the open manuscript.",
		parameters: { path: {
			type: "string",
			description: "Workspace-relative directory; omit for the workspace root."
		} },
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			return (await modelStore(exec.agent)).listFiles(args.path ?? "", "bib");
		},
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: "Find BibTeX files"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_bib_bind",
		description: "Bind the manuscript to explicit workspace-relative .bib files. These files are the sole citation-key authority. Replaces the previous binding list, writes only private binding metadata, and never edits the manuscript or bibliography.",
		parameters: {
			path: pathParameter,
			files: {
				type: "array",
				required: true,
				items: { type: "string" },
				description: "Complete list of existing workspace-relative .bib paths."
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			return {
				...await (await modelStore(exec.agent)).configureBibliography(args.path, args.files),
				manuscriptWritten: false,
				bibliographyWritten: false
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Bind bibliography files"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_bib_list",
		description: "Read bound authoritative BibTeX sources and citation diagnostics. Report citationStatus and canonicalCitationCount: missingKeys=[] alone does not mean citations are valid when possibleBareKeys lists legacy text or no canonical citations exist. Bibliographic metadata is not independently verified.",
		parameters: { path: pathParameter },
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			return (await modelStore(exec.agent)).bibliography(args.path);
		},
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: "Read bibliography index"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_bib_get",
		description: "Read one exact BibTeX entry including its raw source and hash before replacing it. No scholarly source verification is implied.",
		parameters: {
			path: pathParameter,
			key: {
				type: "string",
				required: true
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			return { ...await (await modelStore(exec.agent)).bibliographyEntry(args.path, args.key) };
		},
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: "Read BibTeX entry"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_bib_add",
		description: "Add one complete BibTeX entry to a bound .bib file without a manuscript proposal. Author/title/year syntax is checked, but DOI, metadata and relevance must be verified against the publication. This writes the .bib file, never the manuscript.",
		parameters: {
			path: pathParameter,
			file: {
				type: "string",
				required: true,
				description: "Bound workspace-relative .bib file."
			},
			raw: {
				type: "string",
				required: true,
				description: "One complete BibTeX entry with author, title and year."
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			return {
				...await (await modelStore(exec.agent)).addBibliographyEntry(args.path, args.file, args.raw),
				manuscriptWritten: false,
				bibliographyWritten: true,
				metadataVerified: false
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Add BibTeX entry"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "paper_bib_replace",
		description: "Replace one exact entry in its bound .bib file using the hash returned by paper_bib_get; preserve the key. This writes the .bib file, not a manuscript proposal. Verify bibliographic facts against the publication.",
		parameters: {
			path: pathParameter,
			key: {
				type: "string",
				required: true
			},
			expectedHash: {
				type: "string",
				required: true
			},
			raw: {
				type: "string",
				required: true
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			return {
				...await (await modelStore(exec.agent)).replaceBibliographyEntry(args.path, args.key, args.expectedHash, args.raw),
				manuscriptWritten: false,
				bibliographyWritten: true,
				metadataVerified: false
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Replace BibTeX entry"
		})
	})));
	const scopeAgent = (agent) => {
		scopes.get(agent)?.();
		const disposers = [];
		try {
			if (!enabled.has(agent.id)) disposers.push(agent.ctx.tools.restrict({ deny: [...PAPER_TOOLS] }));
			if (enabled.has(agent.id)) disposers.push(agent.ctx.tools.presentAs("native"));
		} catch (error) {
			for (const dispose of disposers.reverse()) dispose();
			throw error;
		}
		scopes.set(agent, () => {
			for (const dispose of disposers.reverse()) dispose();
		});
	};
	const restoreAgent = async (agent) => {
		const root = config.workspaceRoot ?? agent.session.header.cwd;
		if (root && (await reviewSessions(root)).includes(agent.id)) enabled.add(agent.id);
		scopeAgent(agent);
	};
	ctx.on("agent/created", async ({ agent }) => {
		await restoreAgent(agent);
	});
	for (const agent of ctx.agents.list()) await restoreAgent(agent);
	const methods = [
		"paper-review/command",
		"paper-review/list-files",
		"paper-review/pick-file",
		"paper-review/current",
		"paper-review/figure-path",
		"paper-review/figure-thumbnail",
		"paper-review/leave",
		"paper-review/bibliography",
		"paper-review/bind-bibliography",
		"paper-review/pick-bibliography",
		"paper-review/list-figures",
		"paper-review/pick-figure",
		"paper-review/replace-figure"
	];
	const envelope = z.object({
		type: z.literal("client-request"),
		rpcId: z.string(),
		method: z.enum(methods),
		payload: z.unknown()
	});
	for (const method of methods) ctx.effect(() => ctx.connection.fetch.register({
		path: `/api/${method}`,
		methods: ["POST"],
		requestBody: "buffered",
		async fetch(request) {
			if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") return new Response("Expected application/json", { status: 415 });
			const parsed = envelope.safeParse(await request.json().catch(() => void 0));
			if (!parsed.success || parsed.data.method !== method) return new Response("Invalid review request", { status: 400 });
			let result;
			try {
				request.signal.throwIfAborted();
				const sessionId = SessionId(z.object({ sessionId: z.string().min(1) }).parse(parsed.data.payload).sessionId);
				const store = await storeFor(sessionId);
				if (parsed.data.method === "paper-review/list-files") {
					const listing = z.object({
						path: z.string(),
						extension: z.enum([
							"md",
							"bib",
							"figure"
						]).default("md")
					}).parse(parsed.data.payload);
					result = {
						ok: true,
						value: await store.listFiles(listing.path, listing.extension)
					};
				} else if (parsed.data.method === "paper-review/list-figures") {
					const input = z.object({ path: z.string() }).parse(parsed.data.payload);
					result = {
						ok: true,
						value: await store.listFigures(input.path)
					};
				} else if (parsed.data.method === "paper-review/replace-figure") {
					const input = FigureReplacementSchema.extend({ path: z.string() }).parse(parsed.data.payload);
					if (!enabled.has(sessionId)) throw new Error("Open a manuscript before replacing a figure");
					result = {
						ok: true,
						value: await store.replaceFigure(input.path, input)
					};
				} else if (parsed.data.method === "paper-review/pick-figure") {
					const root = await realpath(await rootFor(sessionId));
					const selected = await pickNativeFigure(root, request.signal);
					if (selected === null) result = {
						ok: true,
						value: { path: null }
					};
					else {
						const path = relative(root, selected).split(sep).join("/");
						await store.figurePath(path);
						result = {
							ok: true,
							value: { path }
						};
					}
				} else if (parsed.data.method === "paper-review/current") result = {
					ok: true,
					value: { path: await store.selectedPath(sessionId) }
				};
				else if (parsed.data.method === "paper-review/bibliography") {
					const input = z.object({ path: z.string() }).parse(parsed.data.payload);
					result = {
						ok: true,
						value: await store.bibliography(input.path)
					};
				} else if (parsed.data.method === "paper-review/bind-bibliography") {
					const input = z.object({
						path: z.string(),
						files: z.array(z.string())
					}).parse(parsed.data.payload);
					if (!enabled.has(sessionId)) throw new Error("Open a manuscript before binding its bibliography");
					result = {
						ok: true,
						value: await store.configureBibliography(input.path, input.files)
					};
				} else if (parsed.data.method === "paper-review/pick-bibliography") {
					const root = await realpath(await rootFor(sessionId));
					const selected = await pickNativeBibliography(root, request.signal);
					if (selected === null) result = {
						ok: true,
						value: { path: null }
					};
					else {
						const path = relative(root, selected);
						if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path) || !/\.bib$/i.test(path)) throw new Error("Chosen .bib file must be inside the conversation workspace");
						result = {
							ok: true,
							value: { path }
						};
					}
				} else if (parsed.data.method === "paper-review/pick-file") {
					const selected = await pickNativeManuscript(await realpath(await rootFor(sessionId)), request.signal);
					if (selected === null) result = {
						ok: true,
						value: { path: null }
					};
					else {
						const path = relative(await realpath(await rootFor(sessionId)), selected);
						if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error("Chosen manuscript must be inside the conversation workspace");
						const { document } = await store.read(path);
						result = {
							ok: true,
							value: { path: document.path }
						};
					}
				} else if (parsed.data.method === "paper-review/figure-path") {
					const figure = z.object({ path: z.string() }).parse(parsed.data.payload);
					result = {
						ok: true,
						value: { path: await store.figurePath(figure.path) }
					};
				} else if (parsed.data.method === "paper-review/figure-thumbnail") {
					const figure = z.object({ path: z.string() }).parse(parsed.data.payload);
					const source = await store.figurePath(figure.path);
					if (!source.toLowerCase().endsWith(".pdf")) throw new Error("PDF thumbnail requires a PDF figure");
					const size = z.object({ size: z.enum(["thumb", "full"]).default("thumb") }).parse(parsed.data.payload).size;
					result = {
						ok: true,
						value: { url: await pdfThumbnail(source, request.signal, size) }
					};
				} else if (parsed.data.method === "paper-review/leave") {
					const agent = ctx.agents.get(sessionId);
					if (agent?.status === "running") throw new Error("Wait for the current response to finish before leaving Paper mode");
					if (enabled.has(sessionId)) {
						enabled.delete(sessionId);
						try {
							if (agent) scopeAgent(agent);
							await store.disableSession(sessionId);
						} catch (error) {
							enabled.add(sessionId);
							if (agent) scopeAgent(agent);
							throw error;
						}
					}
					result = {
						ok: true,
						value: null
					};
				} else {
					const request = z.object({ command: CommandSchema }).parse(parsed.data.payload).command;
					if (!enabled.has(sessionId)) {
						if (request.action !== "open") throw new Error("Open a manuscript before performing review actions");
						await store.read(request.path);
						await enable(sessionId, store, false);
					}
					const view = await store.command(request);
					if (request.action === "open") await store.selectPath(sessionId, view.document.path);
					result = {
						ok: true,
						value: view
					};
				}
			} catch (error) {
				result = {
					ok: false,
					error: {
						code: "paper-review/refused",
						message: error instanceof Error ? error.message : String(error),
						details: {}
					}
				};
			}
			return Response.json({
				type: "server-response",
				rpcId: parsed.data.rpcId,
				result
			});
		}
	}));
}
//#endregion
export { Config, PAPER_DISCOVERY_TOOLS, PAPER_TOOLS, apply, inject, name };
