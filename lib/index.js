import { createRequire } from "node:module";
import ConfigSchema from "@deepseek-ai/schemastery";
import { z } from "zod";
import { access, chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import { gt, satisfies, valid } from "semver";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { tryLockExclusive } from "@deepseek-ai/node-addon-system/flock";
import { runNativeCommand } from "@deepseek-ai/dsh-native-command";
//#region src/update-service.ts
/** Updater adapted from Biogod2020/dsh-ssh; Apache-2.0, see THIRD-PARTY-NOTICES. */
const run = promisify(execFile);
const xml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
const powershell = (code) => [
	"powershell.exe",
	"-NoLogo",
	"-NoProfile",
	"-NonInteractive",
	"-EncodedCommand",
	Buffer.from("$ErrorActionPreference = 'Stop'; " + code, "utf16le").toString("base64")
];
const unitArg = (text) => "\"" + text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("%", "%%").replaceAll("$", "$$") + "\"";
/** A per-user scheduler keeps the helper available if DSH later refuses the old plugin. */
function updateServicePlan(configFile, worker, config, platform = process.platform, home = homedir(), uid = process.getuid?.()) {
	const id = "ai.biogod.dsh-article-review-update." + createHash("sha256").update(configFile).digest("hex").slice(0, 16);
	const args = [
		config.executable,
		...config.executableArgs,
		worker,
		"--config",
		configFile
	];
	if (args.some((value) => /[\r\n\0]/.test(value))) throw new Error("Unsupported updater executable or configuration path");
	if (platform === "darwin" && uid !== void 0) {
		const path = join(home, "Library/LaunchAgents", id + ".plist");
		const domain = `gui/${uid}`;
		return {
			files: { [path]: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${id}</string><key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict><key>ELECTRON_RUN_AS_NODE</key><string>1</string></dict><key>RunAtLoad</key><true/><key>StartInterval</key><integer>21600</integer><key>ProcessType</key><string>Background</string></dict></plist>\n` },
			enable: [[
				"launchctl",
				"bootstrap",
				domain,
				path
			]],
			disable: [[
				"launchctl",
				"bootout",
				`${domain}/${id}`
			]]
		};
	}
	if (platform === "linux") {
		const folder = join(home, ".config/systemd/user");
		return {
			files: {
				[join(folder, id + ".service")]: `[Unit]\nDescription=DSH article review plugin updater\n[Service]\nType=oneshot\nEnvironment=ELECTRON_RUN_AS_NODE=1\nExecStart=${args.map(unitArg).join(" ")}\nTimeoutStartSec=infinity\n`,
				[join(folder, id + ".timer")]: `[Unit]\nDescription=Check DSH article review plugin updates\n[Timer]\nOnBootSec=2min\nOnUnitInactiveSec=6h\nUnit=${id}.service\n[Install]\nWantedBy=timers.target\n`
			},
			enable: [[
				"systemctl",
				"--user",
				"daemon-reload"
			], [
				"systemctl",
				"--user",
				"enable",
				"--now",
				id + ".timer"
			]],
			disable: [
				[
					"systemctl",
					"--user",
					"stop",
					id + ".timer"
				],
				[
					"systemctl",
					"--user",
					"disable",
					id + ".timer"
				],
				[
					"systemctl",
					"--user",
					"stop",
					id + ".service"
				]
			]
		};
	}
	if (platform === "win32") {
		const launcher = join(dirname(configFile), "scheduled-update.ps1");
		const task = psQuote(id);
		const register = `$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psQuote("-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + launcher + "\"")}; $login = New-ScheduledTaskTrigger -AtLogOn -User $user; $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 6); $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited; $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; Register-ScheduledTask -TaskName ${task} -Action $action -Trigger @($login, $repeat) -Principal $principal -Settings $settings -Force | Out-Null`;
		return {
			files: { [launcher]: "$ErrorActionPreference = 'Stop'\n$env:ELECTRON_RUN_AS_NODE = '1'\n& " + args.map(psQuote).join(" ") + "\nexit $LASTEXITCODE\n" },
			enable: [powershell(register)],
			disable: [powershell(`Get-ScheduledTask -TaskName ${task} -ErrorAction SilentlyContinue | Stop-ScheduledTask; Get-ScheduledTask -TaskName ${task} -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false`)]
		};
	}
	throw new Error("The automatic updater requires macOS launchd, Linux user systemd or Windows Task Scheduler");
}
async function configureUpdateService(configFile, worker, config, enabled) {
	const plan = updateServicePlan(configFile, worker, config);
	if (!enabled) for (const path of Object.keys(plan.files)) await rm(path, { force: true });
	for (const args of plan.disable) try {
		await run(args[0], args.slice(1), {
			timeout: 3e4,
			windowsHide: true
		});
	} catch {}
	if (enabled) {
		for (const [path, content] of Object.entries(plan.files)) {
			await mkdir(join(path, ".."), {
				recursive: true,
				mode: 448
			});
			await writeFile(path, content, { mode: 384 });
		}
		try {
			for (const args of plan.enable) await run(args[0], args.slice(1), {
				timeout: 3e4,
				windowsHide: true
			});
		} catch (error) {
			for (const args of plan.disable) try {
				await run(args[0], args.slice(1), {
					timeout: 3e4,
					windowsHide: true
				});
			} catch {}
			for (const path of Object.keys(plan.files)) await rm(path, { force: true });
			throw error;
		}
	} else if (process.platform === "linux") await run("systemctl", ["--user", "daemon-reload"], {
		timeout: 3e4,
		windowsHide: true
	}).catch(() => {});
}
//#endregion
//#region src/update-worker.ts
/** Updater adapted from Biogod2020/dsh-ssh; Apache-2.0, see THIRD-PARTY-NOTICES. */
/** Standalone updater. This bundle has no DSH runtime imports. */
const UPDATE_PACKAGE = "dsh-article-review";
const registry = "https://registry.npmjs.org";
const metadataFiles = [
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml"
];
async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}
async function atomicJson(path, value) {
	const temp = path + "." + randomUUID();
	await writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
		mode: 384,
		flag: "wx"
	});
	await rename(temp, path);
}
function processAlive$1(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 1) return true;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
/** Match DSH's package writer lock, so its CLI and this helper cannot write together. */
async function lock(path) {
	try {
		await writeFile(path, `${process.pid}\n`, {
			flag: "wx",
			mode: 384
		});
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		const record = await readFile(path, "utf8");
		if (processAlive$1(Number(record.trim()))) return void 0;
		const claim = path + ".recover";
		try {
			await writeFile(claim, "", {
				flag: "wx",
				mode: 384
			});
		} catch {
			return;
		}
		try {
			if (await readFile(path, "utf8") !== record) return void 0;
			await rm(path);
		} finally {
			await rm(claim, { force: true });
		}
		return lock(path);
	}
	return async () => {
		if ((await readFile(path, "utf8")).trim() === String(process.pid)) await rm(path);
	};
}
async function hostsActive(root) {
	const leases = join(root, "hosts");
	for (const file of await readdir(leases)) {
		if (!/^\d+\.json$/.test(file)) continue;
		if (processAlive$1(Number(file.slice(0, -5)))) return true;
		await rm(join(leases, file), { force: true });
	}
	return false;
}
async function enabled(configFile) {
	try {
		return (await readJson(configFile)).enabled === true;
	} catch {
		return false;
	}
}
async function execute(config, args, cwd) {
	await new Promise((resolveRun, reject) => {
		const child = spawn(config.packageManager.command, [...config.packageManager.args, ...args], {
			cwd,
			env: {
				...process.env,
				...config.packageManager.env,
				ELECTRON_RUN_AS_NODE: "1"
			},
			stdio: "ignore",
			windowsHide: true,
			detached: process.platform !== "win32"
		});
		const timer = setTimeout(() => {
			try {
				if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
				else child.kill("SIGTERM");
			} catch {}
			reject(/* @__PURE__ */ new Error("Package operation exceeded its deadline"));
		}, 18e4);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			code === 0 ? resolveRun() : reject(/* @__PURE__ */ new Error("Package operation failed"));
		});
	});
}
async function limitedFetch(url, maxBytes, json = false) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(3e4),
		redirect: "error",
		headers: json ? {
			Accept: "application/json",
			"Cache-Control": "no-cache"
		} : {}
	});
	if (!response.ok || Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new Error("Update download refused");
	const chunks = [];
	let bytes = 0;
	const reader = response.body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.length;
			if (bytes > maxBytes) throw new Error("Update download exceeded its limit");
			chunks.push(Buffer.from(value));
		}
	} finally {
		await reader.cancel();
	}
	return Buffer.concat(chunks);
}
function compatible(manifest, runtime) {
	return manifest.name === "dsh-article-review" && !!valid(manifest.version) && typeof manifest.engines?.dsh === "string" && satisfies(runtime, manifest.engines.dsh, { includePrerelease: true }) && (!manifest.engines.node || satisfies(process.versions.node, manifest.engines.node));
}
async function textOrNull(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function restore(root, journal) {
	journal.target = join(await realpath(dirname(journal.target)), basename(journal.target));
	journal.backup = join(await realpath(dirname(journal.backup)), basename(journal.backup));
	if (resolve(journal.target) !== join(dirname(root), "node_modules", "dsh-article-review") || dirname(journal.backup) !== root || !/^previous-[a-f0-9-]+$/.test(journal.backup.slice(root.length + 1)) || metadataFiles.some((name) => !(name in journal.files)) || Object.entries(journal.files).some(([name, content]) => !metadataFiles.includes(name) || content !== null && typeof content !== "string")) throw new Error("Invalid update recovery record");
	let backupExists = false;
	try {
		await lstat(journal.backup);
		backupExists = true;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (backupExists) {
		await rm(journal.target, {
			recursive: true,
			force: true
		});
		await rename(journal.backup, journal.target);
	}
	for (const [name, content] of Object.entries(journal.files)) {
		const path = join(dirname(root), name);
		if (content === null) await rm(path, { force: true });
		else {
			const temp = path + "." + randomUUID();
			await writeFile(temp, content, { mode: 384 });
			await rename(temp, path);
		}
	}
	await rm(join(root, "transaction.json"), { force: true });
}
/** One check prepares immutable files, waits for every registered Host, then commits. */
async function runUpdate(configFile, options = {}) {
	configFile = await realpath(configFile);
	const root = dirname(configFile);
	const releaseWorker = await lock(join(root, "worker.lock"));
	if (!releaseWorker) return;
	let unlockProfile;
	let stagedRelease, committed = false;
	const status = (phase, extra = {}) => atomicJson(join(root, "status.json"), {
		phase,
		checkedAt: Date.now(),
		...extra
	});
	try {
		const config = await readJson(configFile);
		config.profile = await realpath(config.profile);
		if (resolve(config.profile, ".dsh-article-review-updates") !== resolve(root)) throw new Error("Invalid update profile");
		const interrupted = await textOrNull(join(root, "transaction.json"));
		if (interrupted !== null) {
			await status("failed");
			while (await hostsActive(root)) await setTimeout$1(1e3);
			const release = await lock(join(config.profile, "package.json.lock"));
			if (!release) return;
			try {
				await restore(root, JSON.parse(interrupted));
				await status("failed");
			} finally {
				await release();
			}
			return;
		}
		if (!config.enabled) return;
		const target = join(config.profile, "node_modules", "dsh-article-review");
		const spec = (await readJson(join(config.profile, "package.json"))).dependencies?.[UPDATE_PACKAGE];
		if (!spec) {
			await atomicJson(configFile, {
				...config,
				enabled: false
			});
			await configureUpdateService(configFile, process.argv[1], config, false);
			return;
		}
		if (/^(?:file:|link:|workspace:|git|https?:)/.test(spec)) throw new Error("Automatic updates require an npm-installed plugin");
		const current = await readJson(join(target, "package.json"));
		const runtime = (await readJson(config.runtimeManifest)).version;
		if (!runtime || !valid(runtime) || current.name !== "dsh-article-review" || !valid(current.version)) throw new Error("Cannot determine installed versions");
		await status("checking");
		const source = options.registry ?? registry;
		const document = JSON.parse((await limitedFetch(source + "/dsh-article-review", 8 * 1024 * 1024, true)).toString());
		const candidate = document.versions[document["dist-tags"].latest];
		if (!candidate || !compatible(candidate, runtime) || !gt(candidate.version, current.version)) {
			await status("ready");
			return;
		}
		const version = candidate.version;
		const tarball = new URL(candidate.dist?.tarball ?? "");
		const allowed = new URL(source);
		if (tarball.origin !== allowed.origin || tarball.pathname !== `/dsh-article-review/-/dsh-article-review-${version}.tgz` || !/^sha512-[A-Za-z0-9+/]+=*$/.test(candidate.dist?.integrity ?? "")) throw new Error("Invalid update artifact");
		const bytes = await limitedFetch(tarball.href, 16 * 1024 * 1024);
		if ("sha512-" + createHash("sha512").update(bytes).digest("base64") !== candidate.dist.integrity) throw new Error("Update checksum mismatch");
		const stage = join(root, "releases", version + "-" + randomUUID());
		stagedRelease = stage;
		await mkdir(stage, {
			recursive: true,
			mode: 448
		});
		const archive = join(stage, "package.tgz");
		await writeFile(archive, bytes, { mode: 384 });
		await atomicJson(join(stage, "package.json"), { private: true });
		await execute(config, [
			"add",
			archive,
			"--ignore-scripts",
			"--ignore-pnpmfile",
			"--ignore-workspace",
			"--save-exact",
			"--registry=" + source
		], stage);
		const prepared = join(stage, "node_modules", "dsh-article-review");
		const installed = await readJson(join(prepared, "package.json"));
		if (installed.version !== version || !compatible(installed, runtime)) throw new Error("Prepared package is incompatible");
		for (const file of [
			"lib/index.js",
			"lib/client.js",
			"lib/update-worker.js",
			"cordis.patch.yml"
		]) if (!(await lstat(join(prepared, file))).isFile()) throw new Error("Prepared package is incomplete");
		await status("waiting", { availableVersion: version });
		while (await hostsActive(root)) {
			if (!await enabled(configFile)) return;
			await setTimeout$1(1e3);
		}
		await setTimeout$1(1500);
		if (!await enabled(configFile) || await hostsActive(root)) return;
		while (!(unlockProfile = await lock(join(config.profile, "package.json.lock")))) {
			if (!await enabled(configFile) || await hostsActive(root)) return;
			await setTimeout$1(1e3);
		}
		if (await hostsActive(root) || !await enabled(configFile)) return;
		const before = await readJson(join(config.profile, "package.json"));
		if (before.dependencies?.["dsh-article-review"] !== spec || (await readJson(join(target, "package.json"))).version !== current.version) throw new Error("Plugin changed while preparing the update");
		const files = {};
		for (const file of metadataFiles) files[file] = await textOrNull(join(config.profile, file));
		const nextRuntime = (await readJson(config.runtimeManifest)).version;
		if (!nextRuntime || !compatible(installed, nextRuntime)) throw new Error("DSH changed while preparing the update");
		if (!await enabled(configFile) || await hostsActive(root)) return;
		const journal = {
			target,
			backup: join(root, "previous-" + randomUUID()),
			moved: false,
			linked: false,
			files
		};
		await atomicJson(join(root, "transaction.json"), journal);
		try {
			await execute(config, [
				"add",
				"dsh-article-review@" + version,
				"--lockfile-only",
				"--ignore-scripts",
				"--ignore-pnpmfile",
				"--save-exact",
				"--registry=" + source
			], config.profile);
			if (await textOrNull(join(config.profile, "pnpm-workspace.yaml")) !== files["pnpm-workspace.yaml"]) throw new Error("Package policy changed during the update");
			if ((await readJson(join(config.profile, "package.json"))).dependencies?.["dsh-article-review"] !== version || !(await readFile(join(config.profile, "pnpm-lock.yaml"), "utf8")).includes(candidate.dist.integrity)) throw new Error("Prepared lockfile does not match the verified package");
			await atomicJson(join(config.profile, "package.json"), {
				...before,
				dependencies: {
					...before.dependencies,
					[UPDATE_PACKAGE]: version
				}
			});
			await options.afterStep?.("package.json");
			if (await hostsActive(root) || !await enabled(configFile)) throw new Error("A Host started during installation");
			await rename(target, journal.backup);
			journal.moved = true;
			await atomicJson(join(root, "transaction.json"), journal);
			await options.afterStep?.("moved");
			await symlink(await realpath(prepared), target, process.platform === "win32" ? "junction" : "dir");
			journal.linked = true;
			await atomicJson(join(root, "transaction.json"), journal);
			if (await hostsActive(root) || !await enabled(configFile)) throw new Error("A Host started during installation");
			await rm(join(root, "transaction.json"));
			committed = true;
			await status("installed", { installedVersion: version });
		} catch (error) {
			await restore(root, journal);
			throw error;
		}
	} catch (error) {
		options.onError?.(error);
		await status("failed");
	} finally {
		if (stagedRelease && !committed && await textOrNull(join(root, "transaction.json")) === null) await rm(stagedRelease, {
			recursive: true,
			force: true
		});
		await unlockProfile?.();
		await releaseWorker();
	}
}
if (process.argv[1] && process.argv[2] === "--config") try {
	if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) runUpdate(process.argv[3]).catch(() => {
		process.exitCode = 1;
	});
} catch {}
//#endregion
//#region src/self-update.ts
/** Updater adapted from Biogod2020/dsh-ssh; Apache-2.0, see THIRD-PARTY-NOTICES. */
var SelfUpdate = class {
	profile;
	options;
	configFile;
	worker;
	config;
	supported = false;
	initialized;
	operation = Promise.resolve();
	packageRoot;
	runningVersion = "";
	constructor(profile, options = {}) {
		this.profile = profile;
		this.options = options;
		this.packageRoot = options.packageRoot ?? fileURLToPath(new URL("..", import.meta.url));
		this.initialized = this.initialize().catch(async () => {
			if (this.configFile && this.config?.enabled) await atomicJson(join(dirname(this.configFile), "status.json"), {
				phase: "failed",
				checkedAt: Date.now()
			}).catch(() => {});
		});
	}
	async initialize() {
		this.runningVersion = (await readJson(join(this.packageRoot, "package.json"))).version;
		if (!this.profile || !isAbsolute(this.profile.dir) || !isAbsolute(this.profile.installAnchor) || ![
			"darwin",
			"linux",
			"win32"
		].includes(process.platform)) return;
		const spec = (await readJson(join(this.profile.dir, "package.json"))).dependencies?.[UPDATE_PACKAGE];
		if (!spec || /^(?:file:|link:|workspace:|git|https?:)/.test(spec)) return;
		const root = join(this.profile.dir, ".dsh-article-review-updates");
		await mkdir(join(root, "hosts"), {
			recursive: true,
			mode: 448
		});
		if ((await lstat(root)).isSymbolicLink() || (await lstat(join(root, "hosts"))).isSymbolicLink()) return;
		await chmod(root, 448);
		await chmod(join(root, "hosts"), 448);
		await atomicJson(join(root, "hosts", process.pid + ".json"), { pid: process.pid });
		this.configFile = join(root, "config.json");
		let previous;
		try {
			previous = await readJson(this.configFile);
		} catch {}
		const packageManager = { ...this.profile.packageManager ?? {
			command: "pnpm",
			args: [],
			env: {}
		} };
		if (!isAbsolute(packageManager.command)) {
			const candidates = (process.env.PATH ?? "").split(delimiter).flatMap((dir) => (process.platform === "win32" ? [".exe", ".cmd"] : [""]).map((ext) => join(dir, packageManager.command + ext)));
			const command = (await Promise.all(candidates.map(async (path) => {
				try {
					await access(path);
					return path;
				} catch {
					return;
				}
			}))).find(Boolean);
			if (!command) return;
			packageManager.command = command;
		}
		if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(packageManager.command)) {
			const require = createRequire(join(dirname(packageManager.command), "updater.cjs"));
			let entry;
			for (const name of ["pnpm", "corepack"]) try {
				const candidate = join(dirname(require.resolve(name + "/package.json")), name === "pnpm" ? "bin/pnpm.cjs" : "dist/pnpm.js");
				await access(candidate);
				entry = candidate;
				break;
			} catch {}
			if (!entry) return;
			packageManager.command = process.execPath;
			packageManager.args = [
				...process.versions.electron ? ["--expose-internals"] : [],
				entry,
				...packageManager.args
			];
		}
		this.config = {
			enabled: previous?.enabled === true,
			profile: this.profile.dir,
			runtimeManifest: this.profile.installAnchor,
			executable: process.execPath,
			executableArgs: process.versions.electron ? ["--expose-internals"] : [],
			packageManager: {
				command: packageManager.command,
				args: [...packageManager.args],
				env: {
					PATH: process.env.PATH ?? "",
					...packageManager.env
				}
			}
		};
		const bytes = await readFile(join(this.packageRoot, "lib/update-worker.js"));
		this.worker = join(root, "worker-" + createHash("sha256").update(bytes).digest("hex").slice(0, 16) + ".mjs");
		await writeFile(this.worker, bytes, { mode: 384 });
		await atomicJson(this.configFile, this.config);
		this.supported = true;
		if (this.config.enabled) {
			await (this.options.configureService ?? configureUpdateService)(this.configFile, this.worker, this.config, true);
			this.launch();
		} else try {
			await access(join(root, "transaction.json"));
			this.launch();
		} catch {}
	}
	launch() {
		if (!this.configFile || !this.worker || !this.config) return;
		if (this.options.launch) {
			this.options.launch(this.configFile, this.worker, this.config);
			return;
		}
		const child = spawn(this.config.executable, [
			...this.config.executableArgs,
			this.worker,
			"--config",
			this.configFile
		], {
			detached: true,
			windowsHide: true,
			stdio: "ignore",
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1"
			}
		});
		child.on("error", () => {
			atomicJson(join(dirname(this.configFile), "status.json"), {
				phase: "failed",
				checkedAt: Date.now()
			}).catch(() => {});
		});
		child.unref();
	}
	async view() {
		await this.initialized;
		if (this.config && this.configFile) try {
			this.config.enabled = (await readJson(this.configFile)).enabled === true;
		} catch {
			this.config.enabled = false;
		}
		const view = {
			enabled: this.config?.enabled === true,
			supported: this.supported,
			runningVersion: this.runningVersion,
			phase: this.supported ? this.config?.enabled ? "ready" : "disabled" : "unsupported"
		};
		if (this.configFile && view.enabled) try {
			const status = await readJson(join(dirname(this.configFile), "status.json"));
			if ([
				"ready",
				"checking",
				"waiting",
				"installed",
				"failed"
			].includes(status.phase ?? "")) view.phase = status.phase;
			if (typeof status.availableVersion === "string") view.availableVersion = status.availableVersion;
			if (typeof status.installedVersion === "string") view.installedVersion = status.installedVersion;
			if (typeof status.checkedAt === "number") view.checkedAt = status.checkedAt;
		} catch {}
		return view;
	}
	async setEnabled(value) {
		await this.initialized;
		const change = this.operation.then(async () => {
			if (!this.supported || !this.configFile || !this.worker || !this.config) throw new Error("Automatic updates are unavailable in this installation");
			this.config.enabled = value;
			await atomicJson(this.configFile, this.config);
			try {
				await (this.options.configureService ?? configureUpdateService)(this.configFile, this.worker, this.config, value);
			} catch {
				this.config.enabled = false;
				await atomicJson(this.configFile, this.config);
				throw new Error("Could not configure the user update service. Keep DSH running under your desktop account and try again.");
			}
			if (value) this.launch();
			else try {
				await access(join(dirname(this.configFile), "transaction.json"));
				this.launch();
			} catch {}
		});
		this.operation = change.catch(() => {});
		await change;
		return this.view();
	}
};
//#endregion
//#region src/figure-thumbnail.ts
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
//#region src/pdf-preview-cache.ts
/** Bounded reuse and a shared converter queue for authenticated PDF previews. */
async function fingerprint(path) {
	const file = await stat(path, { bigint: true });
	return `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`;
}
/** Plugin-lifetime memory and converter limits; callers independently own cancellation. */
var PdfPreviewCache = class {
	maxBytes;
	concurrency;
	render;
	lifetime = new AbortController();
	cached = /* @__PURE__ */ new Map();
	pending = /* @__PURE__ */ new Map();
	queue = [];
	bytes = 0;
	active = 0;
	constructor(maxBytes, concurrency, render = pdfThumbnail) {
		this.maxBytes = maxBytes;
		this.concurrency = concurrency;
		this.render = render;
	}
	slot(signal) {
		signal.throwIfAborted();
		if (this.active < this.concurrency) {
			this.active++;
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const start = () => {
				signal.removeEventListener("abort", abort);
				this.active++;
				resolve();
			};
			const abort = () => {
				const at = this.queue.indexOf(start);
				if (at >= 0) this.queue.splice(at, 1);
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
			this.queue.push(start);
		});
	}
	async convert(path, size, identity, key, signal) {
		await this.slot(signal);
		try {
			signal.throwIfAborted();
			const url = await this.render(path, signal, size);
			signal.throwIfAborted();
			if (await fingerprint(path) !== identity) throw new Error("Figure changed while creating preview; retry");
			if (url) {
				const bytes = Buffer.byteLength(url) + Buffer.byteLength(key);
				if (bytes <= this.maxBytes) {
					while (this.bytes + bytes > this.maxBytes) {
						const oldest = this.cached.keys().next().value;
						if (oldest === void 0) break;
						this.bytes -= this.cached.get(oldest).bytes;
						this.cached.delete(oldest);
					}
					this.cached.set(key, {
						url,
						bytes
					});
					this.bytes += bytes;
				}
			}
			return url;
		} finally {
			this.active--;
			this.queue.shift()?.();
		}
	}
	/** Resolve only an already workspace-validated path; file identity prevents reuse after replacement. */
	async get(path, signal, size = "thumb") {
		signal.throwIfAborted();
		this.lifetime.signal.throwIfAborted();
		const identity = await fingerprint(path);
		signal.throwIfAborted();
		this.lifetime.signal.throwIfAborted();
		const key = `${path}\0${size}\0${identity}`;
		const cached = this.cached.get(key);
		if (cached) {
			this.cached.delete(key);
			this.cached.set(key, cached);
			return cached.url;
		}
		let flight = this.pending.get(key);
		if (!flight || flight.controller.signal.aborted) {
			const controller = new AbortController();
			const owned = {
				controller,
				readers: /* @__PURE__ */ new Set(),
				promise: Promise.resolve(void 0)
			};
			owned.promise = this.convert(path, size, identity, key, AbortSignal.any([controller.signal, this.lifetime.signal])).finally(() => {
				if (this.pending.get(key) === owned) this.pending.delete(key);
			});
			flight = owned;
			this.pending.set(key, flight);
		}
		const owned = flight, reader = Symbol();
		owned.readers.add(reader);
		return new Promise((resolve, reject) => {
			const release = () => {
				signal.removeEventListener("abort", abort);
				owned.readers.delete(reader);
				if (owned.readers.size === 0) owned.controller.abort();
			};
			const abort = () => {
				release();
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
			owned.promise.then((value) => {
				release();
				resolve(value);
			}, (error) => {
				release();
				reject(error);
			});
		});
	}
	/** Abort queued/running converters and release all retained preview data on plugin disposal. */
	dispose() {
		this.lifetime.abort();
		this.cached.clear();
		this.bytes = 0;
		this.pending.clear();
	}
};
//#endregion
//#region src/figures.ts
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
//#region src/figure-panels.ts
/** Source-backed panel regions and exact paragraph associations, separate from manuscript edits. */
/** Normalized top-left crop coordinates on a rendered source page. */
const PanelRegionSchema = z.tuple([
	z.number().min(0).max(1),
	z.number().min(0).max(1),
	z.number().min(0).max(1),
	z.number().min(0).max(1)
]).refine(([left, top, right, bottom]) => left < right && top < bottom, "Crop must have positive area");
const target = z.object({
	blockId: z.string().min(1),
	before: z.string().min(1).max(2e6)
});
/** Replace the complete panel map for one figure; an empty list removes that map. */
const PanelInputSchema = z.object({
	revision: z.string().min(1),
	figureBlockId: z.string().min(1),
	figure: z.string().min(1),
	sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
	panels: z.array(z.object({
		label: z.string().min(1).max(80),
		file: z.string().min(1),
		page: z.number().int().min(1),
		region: PanelRegionSchema,
		targets: z.array(target).min(1).max(100)
	})).max(52)
}).refine((input) => new Set(input.panels.map((panel) => panel.label.toLowerCase())).size === input.panels.length, "Panel labels must be unique within a figure");
/** Panel files and parent sources retain immutable workspace snapshots. */
const FigurePanelSchema = z.object({
	id: z.string(),
	figureBlockId: z.string(),
	figure: z.string(),
	label: z.string(),
	sourceHash: z.string(),
	sourceFile: z.string(),
	file: z.string(),
	hash: z.string(),
	page: z.number().int().min(1),
	region: PanelRegionSchema,
	targets: z.array(target),
	stale: z.boolean().optional()
});
/** Confirm one saved map without repeating manuscript text or other figures' maps. */
function panelAcknowledgement(panels, input) {
	const saved = panels.filter((panel) => panel.figureBlockId === input.figureBlockId && panel.figure === input.figure);
	return {
		figureBlockId: input.figureBlockId,
		figure: input.figure,
		panelCount: saved.length,
		totalPanels: panels.length,
		panels: saved.map((panel) => ({
			id: panel.id,
			label: panel.label,
			file: panel.file,
			page: panel.page,
			region: panel.region,
			targetBlockIds: panel.targets.map((target) => target.blockId),
			...panel.stale === void 0 ? {} : { stale: panel.stale }
		})),
		manuscriptWritten: false,
		originalFilesWritten: false
	};
}
//#endregion
//#region src/schema.ts
/** Validated on-disk and RPC records. Review baselines change only on an explicit human action. */
const id$1 = z.string().min(1).max(160);
const text$1 = z.string().max(2e6);
/** A source block, with a durable identity independent of its position and content hash. */
const BlockSchema = z.object({
	id: id$1,
	kind: z.string(),
	section: z.string(),
	text: text$1,
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
	id: id$1,
	text: text$1,
	blocks: z.array(BlockSchema),
	createdAt: z.string(),
	figureAssets: z.array(FigureAssetSchema).optional()
});
/** A quotation anchored to the block and the exact version the reader saw. */
const AnnotationSchema = z.object({
	id: id$1,
	blockId: id$1,
	revision: id$1,
	quote: text$1,
	prefix: text$1,
	suffix: text$1,
	comment: text$1,
	renderedSource: text$1.optional(),
	offset: z.number().int().nonnegative().optional(),
	status: z.enum(["open", "resolved"]),
	anchor: z.enum(["attached", "needs-location"])
});
/** Reader marks retain their source snapshot; removal is reversible and never edits the manuscript. */
const HighlightSchema = z.object({
	id: id$1,
	blockId: id$1,
	revision: id$1,
	quote: z.string().min(1).max(1e5),
	prefix: text$1,
	suffix: text$1,
	renderedSource: text$1,
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
	blockId: id$1,
	before: text$1,
	after: text$1,
	operation: z.enum(["insert-before", "insert-after"]).optional()
});
/** A model proposal is never itself a write authorization. */
const ProposalInputSchema = z.object({
	baseRevision: id$1,
	annotationIds: z.array(id$1),
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
	proposalId: id$1,
	revision: id$1,
	baseRevision: id$1.optional(),
	...ProposalInputSchema.omit({ baseRevision: true }).partial().shape
}).refine((input) => input.baseRevision !== void 0 || input.annotationIds !== void 0 || input.reason !== void 0 || input.meaning !== void 0 || input.edits !== void 0, "Provide at least one proposal field to revise");
/** A proposal and the deterministic checks recorded when it was submitted. */
const ProposalSchema = ProposalInputSchema.extend({
	id: id$1,
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
		blockId: id$1,
		before: FigureAssetSchema,
		after: FigureAssetSchema
	})).optional()
});
/** Snapshot-backed figure replacement; source writes still require acceptance. */
const FigureReplacementSchema = z.object({
	revision: id$1,
	blockId: id$1,
	figure: z.string().min(1),
	replacement: z.string().min(1),
	reason: z.string().min(1).max(4e3),
	proposalId: id$1.optional()
});
/** Per-block human review state; accepting a proposal does not advance it. */
const BaselineSchema = z.object({
	blockId: id$1,
	revision: id$1,
	text: text$1,
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
	figurePanels: z.array(FigurePanelSchema).optional(),
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
		revision: id$1
	}),
	z.object({
		action: z.literal("annotate"),
		path: z.string(),
		revision: id$1,
		blockId: id$1,
		quote: text$1,
		prefix: text$1,
		suffix: text$1,
		rendered: z.boolean().optional(),
		offset: z.number().int().nonnegative().optional(),
		comment: z.string().min(1).max(4e3)
	}),
	z.object({
		action: z.literal("highlight"),
		path: z.string(),
		revision: id$1,
		blockId: id$1,
		quote: z.string().min(1).max(1e5),
		prefix: text$1,
		suffix: text$1,
		offset: z.number().int().nonnegative(),
		color: HighlightSchema.shape.color
	}),
	z.object({
		action: z.literal("set-highlight"),
		path: z.string(),
		highlightId: id$1,
		removed: z.boolean()
	}),
	z.object({
		action: z.literal("resolve"),
		path: z.string(),
		annotationId: id$1,
		resolved: z.boolean()
	}),
	z.object({
		action: z.literal("review"),
		path: z.string(),
		revision: id$1,
		blockIds: z.array(id$1).min(1),
		locked: z.boolean()
	}),
	z.object({
		action: z.literal("unlock"),
		path: z.string(),
		blockId: id$1
	}),
	z.object({
		action: z.literal("archive-baseline"),
		path: z.string(),
		revision: id$1,
		blockId: id$1
	}),
	z.object({
		action: z.literal("restore-baseline"),
		path: z.string(),
		revision: id$1,
		blockId: id$1,
		archivedAt: z.string()
	}),
	z.object({
		action: z.literal("relink-baseline"),
		path: z.string(),
		revision: id$1,
		blockId: id$1,
		targetBlockId: id$1
	}),
	z.object({
		action: z.literal("decide"),
		path: z.string(),
		revision: id$1,
		proposalId: id$1,
		accept: z.boolean()
	}),
	z.object({
		action: z.literal("position"),
		path: z.string(),
		reader: id$1,
		blockId: id$1
	})
]);
/** Wire response, also validates browser reads before rendering. */
const ViewSchema = z.object({
	document: DocumentSchema,
	diskChanged: z.boolean()
});
/** Hash-checked deletion copies exact Markdown on the host rather than through model arguments. */
const DeletionInputSchema = z.object({
	baseRevision: id$1,
	blockId: id$1,
	beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
	reason: z.string().min(1).max(4e3),
	proposalId: id$1.optional()
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
//#region src/change-audit.ts
const unit = String.raw`(?:[fpnumcdkMGTµμ]?mol|[fpnumcdkMGTµμ]?g|[fpnumcdkMGTµμ]?[lL]|[fpnumcdkMGTµμ]?M|[fpnumcdkMGTµμ]?m|[fpnumcdkMGTµμ]?s|[kMGT]?Hz|mmHg|[cm]?Gy|Bq|IU|U|K|°[CF]|min|h|days?|weeks?|months?|years?|fold)`;
const comparator = String.raw`(?:<=|>=|!=|[<>≤≥=≠≈~]|\\(?:leq?|geq?|neq|approx|sim))`;
const number = String.raw`(?:[+\-−±]\s*)?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:[eE][+\-−]?\d+)?`;
const exponent = String.raw`(?:\^?[−\-]?\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)?`;
const units$1 = String.raw`(?:[%‰]|${unit}${exponent}(?:\s*\/\s*${unit}${exponent})*(?![\p{L}]))`;
const patterns = [
	["numbers", new RegExp(String.raw`(?:${comparator}\s*|(?<![\p{L}\p{N}_.]))${number}(?:\s*${units$1})?`, "gu")],
	["citations", /\[@[^\]]+\]|\[cite:\s*[^\]]+\]|\\cite\w*\{[^}]+\}|\[\d+(?:[-,–]\s*\d+)*\]|\b[a-z][a-z0-9:_-]*(?:19|20)\d{2}[a-z]?\b/g],
	["figures", /\b(?:fig(?:ure)?\.?|table|supplement(?:ary)?|extended data)\s*[\da-z.()-]+/gi],
	["claim-language", /\b(?:all|always|never|consistently|significant(?:ly)?|robust(?:ly)?|generali[sz]\w*|caus\w*|prove\w*|superior|outperform\w*|novel|first|only|may|might|not|no|cannot)\b|所有|显著|因果|证明|泛化|优于|首次|可能|未|不/g]
];
/** File destinations and citation keys are identifiers, not manuscript quantities. */
function identifierSpans(source) {
	return [...source.matchAll(/\[@[^\]]+\]|\[cite:\s*[^\]]+\]|\\cite\w*\{[^}]+\}|https?:\/\/[^\s<>`]+|(?:[^\s`()[\]<>,]+\/)+[^\s`()[\]<>,]+\.[a-zA-Z\d]{1,8}|`[^`\n]+\.[a-zA-Z\d]{1,8}`|\]\(([^)]+)\)/g)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length
	}));
}
function normalized(token, category) {
	return category === "numbers" ? token.text.replace(/\s+/g, "").replaceAll("μ", "µ").replaceAll("−", "-") : token.text;
}
/**
* Compare ordered lexical tokens; swapped values remain visible even if their multisets match.
* @param before - exact replaced source, or empty for an insertion.
* @param after - proposed exact source.
* @param limit - maximum examples on each side, from 1 to 100.
* @returns only changed categories with bounded, source-grounded evidence.
*/
function auditTextChanges(before, after, limit = 12) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Evidence limit must be an integer between 1 and 100");
	const changes = [];
	const ignored = {
		before: identifierSpans(before),
		after: identifierSpans(after)
	};
	for (const [category, pattern] of patterns) {
		const tokens = (source, spans) => [...source.matchAll(new RegExp(pattern))].filter((match) => category !== "numbers" || !spans.some((span) => match.index >= span.start && match.index < span.end)).map((match) => ({
			text: match[0],
			start: match.index,
			end: match.index + match[0].length
		}));
		const left = tokens(before, ignored.before), right = tokens(after, ignored.after);
		let start = 0, leftEnd = left.length, rightEnd = right.length;
		while (start < leftEnd && start < rightEnd && normalized(left[start], category) === normalized(right[start], category)) start++;
		while (leftEnd > start && rightEnd > start && normalized(left[leftEnd - 1], category) === normalized(right[rightEnd - 1], category)) {
			leftEnd--;
			rightEnd--;
		}
		if (start === leftEnd && start === rightEnd) continue;
		const beforeCount = leftEnd - start, afterCount = rightEnd - start;
		changes.push({
			category,
			before: left.slice(start, Math.min(leftEnd, start + limit)),
			after: right.slice(start, Math.min(rightEnd, start + limit)),
			beforeCount,
			afterCount,
			truncated: beforeCount > limit || afterCount > limit
		});
	}
	return changes;
}
//#endregion
//#region src/document.ts
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
	const key = (kind, source) => JSON.stringify([kind, source]);
	const oldByKey = /* @__PURE__ */ new Map();
	const newCounts = /* @__PURE__ */ new Map();
	for (const old of previous?.blocks ?? []) {
		const identity = key(old.kind, replacements.get(old.id) ?? old.text);
		oldByKey.set(identity, oldByKey.has(identity) ? null : old);
	}
	for (const block of blocks) {
		const identity = key(block.kind, block.text);
		newCounts.set(identity, (newCounts.get(identity) ?? 0) + 1);
	}
	for (const block of blocks) {
		const identity = key(block.kind, block.text), candidate = oldByKey.get(identity);
		if (candidate && newCounts.get(identity) === 1) block.id = candidate.id;
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
	const blocks = new Map(revision.blocks.map((block) => [block.id, block]));
	const unique = (source, target) => {
		if (!target) return false;
		const first = source.indexOf(target);
		return first !== -1 && source.indexOf(target, first + 1) === -1;
	};
	return annotations.map((annotation) => {
		const block = blocks.get(annotation.blockId);
		const quote = annotation.quote;
		const needle = annotation.prefix + quote + annotation.suffix;
		const attached = block !== void 0 && (annotation.renderedSource !== void 0 ? block.text === annotation.renderedSource : quote === "" || unique(block.text, needle) || unique(block.text, quote));
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
	const byId = new Map(blocks.map((block) => [block.id, block]));
	const methodBlocks = /* @__PURE__ */ new Set();
	const headings = [];
	for (const block of blocks) {
		if (block.kind === "heading") {
			const depth = block.text.match(/^ {0,3}(#{1,6})(?:\s|$)/)?.[1]?.length ?? (/\n {0,3}=+\s*$/.test(block.text) ? 1 : 2);
			while (headings.length && headings.at(-1).depth >= depth) headings.pop();
			headings.push({
				depth,
				methods: /method|方法|experimental setup|statistical analys/i.test(block.text)
			});
		}
		if (headings.some((heading) => heading.methods) || /method|方法/i.test(block.section)) methodBlocks.add(block.id);
	}
	for (const edit of proposal.edits) {
		for (const evidence of auditTextChanges(edit.operation ? "" : edit.before, edit.after)) flags.add(evidence.category);
		if (methodBlocks.has(edit.blockId)) flags.add("methods");
		const original = byId.get(edit.blockId);
		const resulting = edit.operation ? [] : parseRevision(edit.after).blocks;
		if (proposal.meaning === "structure" || edit.operation || resulting.length !== 1 || resulting[0]?.kind !== original?.kind) flags.add("structure");
	}
	return [...flags];
}
//#endregion
//#region src/review-blocks.ts
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
//#region src/bibliography.ts
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
//#region src/owner-lock.ts
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
	const koffi = createRequire(import.meta.url)(`@koromix/koffi-win32-${process.arch}`);
	if (koffi.version !== "3.1.1") throw new Error("Unsupported Windows lock binding");
	const kernel32 = koffi.load("kernel32.dll");
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
//#region src/store.ts
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
	* List one workspace directory for review files or native document previews.
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
			const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isFile() && (extension === "preview" || (extension === "figure" ? /\.(?:pdf|png|jpe?g|webp|gif|svg)$/i.test(entry.name) : entry.name.toLowerCase().endsWith(`.${extension}`))))).map((entry) => ({
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
	listFigures(path, packet) {
		return this.serial(async () => {
			const { document, disk } = await this.load(path);
			const base = authoredFigureBase(document.current.text);
			const targets = new Map(document.current.blocks.map((block) => [block.id, block.text]));
			const fileHashes = /* @__PURE__ */ new Map();
			const hashFile = (file) => {
				let pending = fileHashes.get(file);
				if (!pending) {
					pending = this.figureData(file).then((data) => createHash("sha256").update(data).digest("hex"));
					fileHashes.set(file, pending);
				}
				return pending;
			};
			const cropHashes = /* @__PURE__ */ new Map();
			for (const panel of document.figurePanels ?? []) if (!cropHashes.has(panel.file)) cropHashes.set(panel.file, await hashFile(panel.file).catch(() => void 0));
			const listing = {
				workspaceRoot: this.root,
				path: document.path,
				revision: document.current.id,
				diskChanged: revisionId(disk) !== document.current.id,
				figures: await Promise.all(collectFigures(document.current.blocks).map(async (figure) => {
					const hash = document.current.figureAssets?.find((asset) => asset.path === figure.path)?.hash;
					const file = figureFilePath(document.path, base, pinnedFigure(document.current, figure).path) ?? null;
					const saved = (document.figurePanels ?? []).filter((panel) => panel.figureBlockId === figure.blockId && panel.figure === figure.path);
					const savedPanels = (sourceHash) => saved.map((panel) => ({
						label: panel.label,
						targetCount: panel.targets.length,
						stale: sourceHash === void 0 || panel.sourceHash !== sourceHash || cropHashes.get(panel.file) !== panel.hash || panel.targets.some((target) => targets.get(target.blockId) !== target.before)
					}));
					try {
						const sourceHash = file ? await hashFile(file) : void 0;
						return {
							...figure,
							file,
							...hash ? { hash } : {},
							...sourceHash ? { sourceHash } : {},
							savedPanels: savedPanels(sourceHash)
						};
					} catch (error) {
						return {
							...figure,
							file,
							error: error instanceof Error ? error.message : String(error),
							savedPanels: savedPanels()
						};
					}
				}))
			};
			const saved = listing.figures.flatMap((figure) => figure.savedPanels);
			const summary = {
				panelCount: saved.length,
				validPanelCount: saved.filter((panel) => !panel.stale).length,
				associationCount: saved.filter((panel) => !panel.stale).reduce((count, panel) => count + panel.targetCount, 0)
			};
			if (packet === void 0) return {
				...listing,
				...summary
			};
			if (listing.diskChanged) throw new Error("Load external manuscript changes before exporting panel context");
			const content = JSON.stringify({
				version: 1,
				workspaceRoot: this.root,
				path: document.path,
				revision: document.current.id,
				figures: listing.figures,
				blocks: document.current.blocks.map(({ id, kind, text }) => ({
					id,
					kind,
					text
				}))
			}, null, 2) + "\n";
			return {
				...listing,
				...summary,
				packet: await this.writePanelPacket(packet, content)
			};
		});
	}
	/** Read prepared arguments; setPanels still checks the current source and every exact paragraph anchor. */
	readPanelManifest(path, manifest) {
		return this.serial(async () => {
			const source = await this.readWorkspaceJson(manifest, 1048576);
			let decoded;
			try {
				decoded = JSON.parse(source.text);
			} catch {
				throw new Error("Panel manifest must contain valid JSON");
			}
			const contents = z.object({
				workspaceRoot: z.string().optional(),
				path: z.string().optional()
			}).passthrough().parse(decoded);
			if (contents.workspaceRoot !== void 0 && (!isAbsolute(contents.workspaceRoot) || await realpath(contents.workspaceRoot).catch(() => void 0) !== this.root)) throw new Error("Panel manifest belongs to a different workspace; export context from the intended manuscript");
			if (contents.path !== void 0 && (await this.locate(contents.path)).source !== (await this.locate(path)).source) throw new Error("Panel manifest belongs to a different manuscript");
			return PanelInputSchema.parse(contents);
		});
	}
	/** Confine JSON artifacts and reject links into review state or another workspace. */
	async workspaceJson(path, createParents) {
		if (!path || isAbsolute(path) || !/\.json$/i.test(path) || path.split(/[\\/]/).some((part) => part === ".." || part.toLowerCase() === ".paper-review")) throw new Error("Choose a workspace-relative .json file outside .paper-review");
		const source = resolve(this.root, path), normalized = relative(this.root, source);
		if (!normalized || normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) throw new Error("Panel JSON file must remain inside the workspace");
		const parts = normalized.split(sep);
		let directory = this.root;
		for (const part of parts.slice(0, -1)) {
			directory = resolve(directory, part);
			if (createParents) await mkdir(directory).catch((error) => {
				if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
			});
			const info = await lstat(directory);
			if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Panel JSON directories must not be symbolic links");
		}
		const info = await lstat(source).catch((error) => {
			if (missing(error)) return void 0;
			throw error;
		});
		if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("Panel JSON must be a regular file, not a symbolic link");
		return {
			source,
			path: normalized
		};
	}
	async readWorkspaceJson(path, maximum) {
		const location = await this.workspaceJson(path, false);
		const handle = await open(location.source, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const info = await handle.stat();
			if (!info.isFile() || info.size > maximum) throw new Error(`Panel JSON must be a regular file no larger than ${maximum} bytes`);
			const bytes = Buffer.alloc(maximum + 1);
			let size = 0;
			while (size < bytes.length) {
				const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
				if (!bytesRead) break;
				size += bytesRead;
			}
			if (size > maximum) throw new Error(`Panel JSON must be no larger than ${maximum} bytes`);
			return {
				text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
				path: location.path
			};
		} finally {
			await handle.close();
		}
	}
	async writePanelPacket(path, content) {
		const maximum = 2097152;
		if (Buffer.byteLength(content) > maximum) throw new Error(`Panel context packet exceeds ${maximum} bytes`);
		const location = await this.workspaceJson(path, true);
		try {
			const handle = await open(location.source, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 256);
			try {
				await handle.writeFile(content);
				await handle.sync();
			} finally {
				await handle.close();
			}
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
			if ((await this.readWorkspaceJson(path, maximum)).text !== content) throw new Error("Panel context packet already exists with different content; choose a new file");
		}
		return location.path;
	}
	/** Replace one figure's panel associations without changing Markdown, original artwork or review baselines. */
	setPanels(path, input) {
		return this.serial(async () => {
			const request = PanelInputSchema.parse(input);
			const { document, key, disk } = await this.load(path);
			this.assertRevision(document, request.revision);
			if (revisionId(disk) !== document.current.id) throw new Error("Load external manuscript changes before arranging panels");
			if (!request.panels.length) {
				document.figurePanels = (document.figurePanels ?? []).filter((panel) => panel.figureBlockId !== request.figureBlockId || panel.figure !== request.figure);
				await atomicWrite(key, JSON.stringify(document));
				return {
					document,
					diskChanged: false
				};
			}
			const figure = collectFigures(document.current.blocks).find((item) => item.blockId === request.figureBlockId && item.path === request.figure);
			if (!figure) throw new Error("Figure reference changed; use paper_figure_list again");
			const base = authoredFigureBase(document.current.text);
			const directory = base || document.path.slice(0, Math.max(0, document.path.lastIndexOf("/")));
			const file = figureFilePath(document.path, base, pinnedFigure(document.current, figure).path);
			if (!file) throw new Error("Figure path is invalid");
			const source = await this.retainFigure(directory, file, figure.path);
			if (source.hash !== request.sourceHash) throw new Error("Source figure changed; inspect and split the current file again");
			for (const panel of request.panels) for (const target of panel.targets) if (!document.current.blocks.some((block) => block.id === target.blockId && block.text === target.before)) throw new Error("Panel target changed; reread the exact paragraph before arranging it");
			const panels = [];
			for (const panel of request.panels) {
				if (!/\.png$/i.test(panel.file)) throw new Error("Panel crops must be PNG files");
				if (!(await this.figureData(panel.file)).subarray(0, 8).equals(Buffer.from([
					137,
					80,
					78,
					71,
					13,
					10,
					26,
					10
				]))) throw new Error("Panel crop is not a PNG image");
				const asset = await this.retainFigure(directory, panel.file, panel.file);
				panels.push({
					id: `${figure.blockId}:${panel.label}`,
					figureBlockId: figure.blockId,
					figure: figure.path,
					label: panel.label,
					sourceHash: source.hash,
					sourceFile: file,
					file: [directory, asset.snapshot].filter(Boolean).join("/"),
					hash: asset.hash,
					page: panel.page,
					region: panel.region,
					targets: panel.targets
				});
			}
			if (createHash("sha256").update(await this.figureData(file)).digest("hex") !== source.hash || await this.sourceText((await this.locate(path)).source) !== disk) throw new Error("Source changed while arranging panels; reread and retry");
			document.figurePanels = [...(document.figurePanels ?? []).filter((panel) => panel.figureBlockId !== figure.blockId || panel.figure !== figure.path), ...panels];
			await atomicWrite(key, JSON.stringify(document));
			return {
				document,
				diskChanged: false
			};
		});
	}
	async panelStatus(document) {
		if (!document.figurePanels?.length) return document;
		const hashes = /* @__PURE__ */ new Map();
		for (const panel of document.figurePanels) if (!hashes.has(panel.sourceFile)) hashes.set(panel.sourceFile, this.figureData(panel.sourceFile).then((data) => createHash("sha256").update(data).digest("hex"), () => void 0));
		return {
			...document,
			figurePanels: await Promise.all(document.figurePanels.map(async (panel) => ({
				...panel,
				stale: await hashes.get(panel.sourceFile) !== panel.sourceHash
			})))
		};
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
				document: await this.panelStatus(document),
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
	/** The same mechanical preflight is used by paper_check and the actual write path. */
	async prepareAcceptance(document, proposal, disk) {
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
		const flags = await this.proposalFlags(document, proposal);
		const sourceText = document.current.text;
		let output = sourceText;
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
		return {
			output,
			flags
		};
	}
	/**
	* Revalidate pending proposals without writing manuscript bytes. Applicability is a snapshot,
	* not an authorization or a claim of scientific validity; acceptance always checks again.
	* @param path - exact workspace-relative manuscript.
	* @returns blockers, fresh flags and source-grounded lexical evidence for every pending proposal.
	*/
	check(path, proposalId) {
		return this.serial(async () => {
			const { document, disk } = await this.load(path);
			const selected = proposalId === void 0 ? void 0 : document.proposals.find((item) => item.id === proposalId && item.status === "pending");
			if (proposalId !== void 0 && !selected) throw new Error("Pending proposal not found");
			const proposals = [];
			for (const proposal of document.proposals.filter((item) => item.status === "pending")) {
				let flags = proposal.flags;
				const blockers = [];
				try {
					flags = (await this.prepareAcceptance(document, proposal, disk)).flags;
				} catch (error) {
					blockers.push(error instanceof Error ? error.message : String(error));
				}
				proposals.push({
					id: proposal.id,
					flags,
					authorDeclaredMeaning: proposal.meaning,
					applicable: blockers.length === 0,
					blockers,
					evidence: proposal.edits.map((edit, editIndex) => ({
						blockId: edit.blockId,
						editIndex,
						changes: auditTextChanges(edit.operation ? "" : edit.before, edit.after)
					})).filter((edit) => edit.changes.length)
				});
			}
			return {
				revision: document.current.id,
				diskChanged: revisionId(disk) !== document.current.id,
				scientificallyVerified: false,
				proposals,
				...selected ? { proposal: selected } : {}
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
						const prepared = await this.prepareAcceptance(document, proposal, disk);
						output = prepared.output;
						proposal.flags = prepared.flags;
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
				document: command.action === "position" ? document : await this.panelStatus(document),
				diskChanged: revisionId(output ?? disk) !== document.current.id
			};
		});
	}
};
//#endregion
//#region src/manuscript-read.ts
/** Revision-pinned pagination without truncating exact Markdown blocks needed for safe edits. */
/** Pagination limits; character budget is soft only for the first indivisible block. */
const ReadPageSchema = z.object({
	startBlock: z.number().int().nonnegative().default(0),
	maxBlocks: z.number().int().min(1).max(200).default(40),
	maxCharacters: z.number().int().min(1e3).max(2e5).default(32e3),
	revision: z.string().min(1).optional()
});
/** Read whole blocks in source order. Never continue across a revision change. */
function readManuscriptPage(revision, input) {
	const options = ReadPageSchema.parse(input);
	if (options.startBlock > 0 && options.revision === void 0) throw new Error("Continuation requires the revision returned by the first page");
	if (options.revision !== void 0 && options.revision !== revision.id) throw new Error("Reader revision changed; restart pagination with the current revision");
	if (options.startBlock > revision.blocks.length) throw new RangeError("startBlock exceeds the manuscript block count");
	let end = options.startBlock, characters = 0;
	while (end < revision.blocks.length && end - options.startBlock < options.maxBlocks) {
		const length = revision.blocks[end].text.length;
		if (end > options.startBlock && characters + length > options.maxCharacters) break;
		characters += length;
		end++;
		if (characters >= options.maxCharacters) break;
	}
	return {
		blocks: revision.blocks.slice(options.startBlock, end),
		page: {
			startBlock: options.startBlock,
			endBlockExclusive: end,
			totalBlocks: revision.blocks.length,
			nextStartBlock: end < revision.blocks.length ? end : null,
			characters,
			exceededCharacterBudget: characters > options.maxCharacters
		}
	};
}
//#endregion
//#region src/workbench-view.ts
/** The browser receives the current manuscript and a historical version index, never every saved body. */
/** Immutable IDs and dates are enough for version choices. */
const RevisionSummarySchema = RevisionSchema.pick({
	id: true,
	createdAt: true
});
z.object({
	document: DocumentSchema.omit({ revisions: true }).extend({ revisions: z.array(RevisionSummarySchema) }),
	diskChanged: z.boolean()
});
/** Project an already validated store read without cloning its current manuscript or altering history. */
function workbenchView(view) {
	return {
		...view,
		document: {
			...view.document,
			revisions: view.document.revisions.map(({ id, createdAt }) => ({
				id,
				createdAt
			}))
		}
	};
}
//#endregion
//#region src/native-file-picker.ts
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
		], signal, "visible");
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
		], signal, "visible");
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
		], signal, "visible");
		const path = stdout.replace(/[\r\n]+$/, "");
		if (!path) throw new Error("Finder returned no BibTeX path");
		return path;
	} catch (error) {
		if (!signal.aborted && typeof error === "object" && error !== null && "code" in error && error.code === 1 && "stderr" in error && typeof error.stderr === "string" && /(?:User canceled|-128)/i.test(error.stderr)) return null;
		throw new Error("Finder could not open the BibTeX file chooser", { cause: error });
	}
}
//#endregion
//#region src/selected-file.ts
/** Resolve a picked host path without allowing an outside file or escaping symlink. */
/** Native and Desktop selections have the same workspace boundary and portable return path. */
async function selectedWorkspaceFile(root, selected, kind) {
	if (!isAbsolute(selected)) throw new Error("Selected file must have an absolute host path");
	const source = await realpath(selected);
	const path = relative(await realpath(root), source);
	if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error("Chosen file must be inside the conversation workspace");
	if (!(kind === "figure" ? /\.(pdf|png|jpg|jpeg|webp|gif|svg)$/i : kind === "bib" ? /\.bib$/i : /\.md$/i).test(path)) throw new Error(`Choose a ${kind === "figure" ? "PDF or image" : `.${kind}`} file`);
	if (!(await stat(source)).isFile()) throw new Error("Choose a file, not a directory");
	return path.split(sep).join("/");
}
//#endregion
//#region src/article-input.ts
/** Stage exact pasted prose, or resolve the file explicitly selected for import. */
const ArticleInputSchema = z.object({
	source: z.string().min(1).max(4e3).optional(),
	text: z.string().min(1).max(2e6).optional()
}).refine((input) => Boolean(input.source) !== Boolean(input.text), "Provide one article file or pasted text");
/** Return a real input path; generated Markdown will still be confined to the workspace. */
async function prepareArticleInput(workspace, input) {
	const root = await realpath(workspace);
	if (input.source !== void 0) {
		if (input.source.includes("\0")) throw new Error("Invalid article path");
		const source = await realpath(isAbsolute(input.source) ? input.source : resolve(root, input.source));
		const info = await stat(source);
		if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error("Choose an article file no larger than 100 MiB");
		return source;
	}
	const text = input.text ?? "";
	if (!text.trim() || Buffer.byteLength(text) > 2e6) throw new Error("Paste nonempty article text no larger than 2 MB");
	const directory = resolve(root, ".paper-import-inputs");
	await mkdir(directory, { mode: 448 }).catch((error) => {
		if (error.code !== "EEXIST") throw error;
	});
	const actual = await realpath(directory);
	const distance = relative(root, actual);
	if (distance === ".." || distance.startsWith(`..${sep}`) || isAbsolute(distance)) throw new Error("Article input directory escapes the workspace");
	const source = resolve(actual, `article-${createHash("sha256").update(text).digest("hex").slice(0, 20)}.txt`);
	const handle = await open(source, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384).catch(async (error) => {
		if (error.code !== "EEXIST") throw error;
		const info = await lstat(source);
		if (!info.isFile() || info.isSymbolicLink() || await readFile(source, "utf8") !== text) throw new Error("Staged article source no longer matches pasted text");
	});
	if (handle) try {
		await handle.writeFile(text, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	return source;
}
//#endregion
//#region src/project/model.ts
/**
* Project mode: a paper is a project that moves from materials to a story-flow skeleton, then to claims and
* figures, then to prose, then to reading review. The skeleton stays the reference after drafting: every
* paragraph records which claims it states and the claim text it was written from, so either side drifting
* is visible.
*/
const id = z.string().min(1).max(80);
const text = z.string().max(2e4);
const StageSchema = z.enum([
	"materials",
	"skeleton",
	"refine",
	"draft",
	"read",
	"submit"
]);
/** A figure panel that can be attached to evidence; image is a workspace path or URL. */
/** image may be omitted in an agent's upsert; applyChanges keeps the existing image of a panel with the same label. */
const PanelSchema = z.object({
	label: z.string().max(40),
	image: z.string().max(2e3).default(""),
	note: z.string().max(2e3).default(""),
	/** kept on purpose without a claim (backup or reviewer-response material), so not flagged as unused */
	spare: z.boolean().default(false)
});
const FigureSchema = z.object({
	id,
	label: z.string().max(40),
	title: z.string().max(400).default(""),
	caption: text.default(""),
	placement: z.enum([
		"main",
		"extended",
		"unplaced"
	]).default("unplaced"),
	file: z.string().max(2e3).default(""),
	panels: z.array(PanelSchema).default([])
});
/** A number the paper may state, with where it comes from; prose and claims are checked against this list. */
const NumberSchema = z.object({
	id,
	label: z.string().max(200),
	value: z.string().max(80),
	source: z.string().max(1e3).default("")
});
const EvidenceSchema = z.object({
	id,
	kind: z.enum([
		"how",
		"support",
		"limit",
		"gap"
	]).default("support"),
	status: z.enum([
		"sufficient",
		"partial",
		"missing",
		"risk"
	]).default("partial"),
	text,
	source: z.string().max(1e3).default(""),
	panels: z.array(z.object({
		figure: id,
		label: z.string().max(40)
	})).default([]),
	/** Gap evidence is a to-do: who closes it and by when. */
	owner: z.string().max(80).default(""),
	due: z.string().max(40).default("")
});
const ClaimSchema = z.object({
	id,
	title: z.string().max(400),
	statement: text,
	role: z.enum(["core", "support"]).default("support"),
	/** What a reviewer will ask; drafting must answer it. */
	reviewerQuestion: text.default(""),
	evidence: z.array(EvidenceSchema).default([])
});
/** One step of the story; claims carry it. */
const BeatSchema = z.object({
	id,
	title: z.string().max(400),
	summary: text.default(""),
	claims: z.array(id).default([])
});
/** A paragraph of the draft. basis = claim id -> hash of that claim when the paragraph was written or synced. */
const ParagraphSchema = z.object({
	id,
	text,
	claims: z.array(id).default([]),
	basis: z.record(z.string(), z.string()).default({})
});
const SectionSchema = z.object({
	id,
	heading: z.string().max(400),
	beat: z.string().max(80).default(""),
	paragraphs: z.array(ParagraphSchema).default([])
});
/** Who said it. Personas are model reviewers with fixed roles; chat is a request made in the conversation. */
/** check = a problem found by checks (initialisation, repository); it reaches the author like a person's comment. */
const COMMENT_SOURCES = [
	"author",
	"collaborator",
	"editor",
	"reviewer",
	"audience",
	"chat",
	"check"
];
const TargetSchema = z.object({
	kind: z.enum([
		"project",
		"thesis",
		"beat",
		"claim",
		"evidence",
		"figure",
		"paragraph"
	]),
	id: z.string().max(80).default(""),
	quote: z.string().max(2e3).default("")
});
const CommentSchema = z.object({
	id,
	target: TargetSchema,
	source: z.enum(COMMENT_SOURCES),
	author: z.string().max(80),
	text,
	status: z.enum([
		"open",
		"answered",
		"closed",
		"declined"
	]).default("open"),
	/** The agent's reply: what it changed, and in which revision. */
	response: z.object({
		text,
		revision: z.number().int(),
		at: z.string()
	}).optional(),
	createdAt: z.string(),
	stage: StageSchema,
	/** Person asked to handle it (a co-author, a student); empty = the author. */
	assignee: z.string().max(80).default("")
});
/** A dependency between claims; only shown in the optional network view. */
const LinkSchema = z.object({
	from: id,
	to: id,
	label: z.string().max(200).default("")
});
const ProjectSchema = z.object({
	schemaVersion: z.literal(1).default(1),
	title: z.string().max(400),
	journal: z.string().max(200).default(""),
	/** Who must understand the paper; personas and drafting read this. */
	audience: z.string().max(1e3).default(""),
	/** House style for drafting, e.g. plain expert English for non-native readers. */
	style: z.string().max(4e3).default(""),
	stage: StageSchema.default("materials"),
	materials: z.array(z.object({
		id,
		label: z.string().max(400),
		path: z.string().max(2e3).default(""),
		note: z.string().max(2e3).default("")
	})).default([]),
	thesis: z.object({
		title: z.string().max(400).default(""),
		statement: text.default("")
	}).default({
		title: "",
		statement: ""
	}),
	beats: z.array(BeatSchema).default([]),
	claims: z.array(ClaimSchema).default([]),
	figures: z.array(FigureSchema).default([]),
	numbers: z.array(NumberSchema).default([]),
	sections: z.array(SectionSchema).default([]),
	links: z.array(LinkSchema).default([]),
	/** Numbers the author checked and keeps unregistered (method parameters etc.): "value" for everywhere, "where|value" for one place. */
	numberIgnores: z.array(z.string().max(200)).default([])
});
/** One recorded change; reason and the comments it answers make the history explain itself. */
const HistoryEntrySchema = z.object({
	revision: z.number().int(),
	at: z.string(),
	actor: z.string(),
	reason: z.string(),
	comments: z.array(id).default([]),
	units: z.array(z.string()).default([])
});
/** Private review state beside the project: comments, the author's reviewed hashes, history. */
/**
* A proposed rewrite of one paragraph, waiting for the author. Prose is never replaced silently: the author sees the
* word diff and accepts or discards it. Accepting checks that the paragraph still reads as `before`.
*/
const DraftSchema = z.object({
	id,
	section: id,
	paragraph: id,
	before: text,
	after: text,
	claims: z.array(id).default([]),
	reason: z.string().max(2e3),
	actor: z.string().max(200),
	comments: z.array(id).default([]),
	createdAt: z.string(),
	status: z.enum([
		"pending",
		"accepted",
		"discarded",
		"stale"
	]).default("pending")
});
const ReviewStateSchema = z.object({
	revision: z.number().int().default(0),
	comments: z.array(CommentSchema).default([]),
	/** unit key -> hash of the content the author last marked reviewed */
	reviewed: z.record(z.string(), z.object({
		hash: z.string(),
		revision: z.number().int(),
		at: z.string()
	})).default({}),
	history: z.array(HistoryEntrySchema).default([]),
	drafts: z.array(DraftSchema).default([]),
	/** Agent's first sort of unregistered numbers ("where|value" -> kind + why); a hint for the author, never a decision. */
	numberHints: z.record(z.string(), z.object({
		kind: z.enum([
			"result",
			"parameter",
			"citation",
			"other"
		]),
		note: z.string().max(400)
	})).default({})
});
/**
* A change the agent or the author applies. Units are replaced whole (upsert) or removed; the store records the
* changed unit keys so the author sees them as "changed since review".
*/
const ChangeSchema = z.discriminatedUnion("op", [
	z.object({
		op: z.literal("set-meta"),
		fields: ProjectSchema.pick({
			title: true,
			journal: true,
			audience: true,
			style: true
		}).partial()
	}),
	z.object({
		op: z.literal("set-thesis"),
		thesis: z.object({
			title: z.string().max(400),
			statement: text
		})
	}),
	z.object({
		op: z.literal("upsert-beat"),
		beat: BeatSchema,
		index: z.number().int().optional()
	}),
	z.object({
		op: z.literal("upsert-claim"),
		claim: ClaimSchema
	}),
	z.object({
		op: z.literal("upsert-figure"),
		figure: FigureSchema
	}),
	z.object({
		op: z.literal("upsert-number"),
		number: NumberSchema
	}),
	z.object({
		op: z.literal("upsert-section"),
		section: SectionSchema,
		index: z.number().int().optional()
	}),
	z.object({
		op: z.literal("upsert-paragraph"),
		section: id,
		paragraph: ParagraphSchema,
		after: z.string().max(80).optional()
	}),
	z.object({
		op: z.literal("remove"),
		unit: z.enum([
			"beat",
			"claim",
			"figure",
			"number",
			"section",
			"paragraph"
		]),
		id
	}),
	z.object({
		op: z.literal("set-links"),
		links: z.array(LinkSchema)
	}),
	z.object({
		op: z.literal("ignore-number"),
		value: z.string().max(80),
		where: z.string().max(120).default("")
	})
]);
//#endregion
//#region src/project/units.ts
/** Stable 53-bit content hash (cyrb53); runs the same in Node and the browser. */
function contentHash(value) {
	const str = JSON.stringify(value);
	let h1 = 3735928559, h2 = 1103547991;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
	h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/**
* The claim content a paragraph is written from: what the claim says and how strong its evidence is. Rewording an
* evidence item or a caption does not make prose stale; changed numbers are caught by the number check instead.
*/
const claimHash = (claim) => contentHash([
	claim.title,
	claim.statement,
	claim.evidence.map((e) => [e.kind, e.status])
]);
/** Everything the author reviews, with its current content hash. Paragraph keys include their section. */
function units(p) {
	const out = [{
		key: "thesis",
		kind: "thesis",
		id: "thesis",
		label: p.thesis.title || "核心论点",
		hash: contentHash(p.thesis)
	}];
	for (const b of p.beats) out.push({
		key: `beat:${b.id}`,
		kind: "beat",
		id: b.id,
		label: b.title,
		hash: contentHash(b)
	});
	for (const c of p.claims) out.push({
		key: `claim:${c.id}`,
		kind: "claim",
		id: c.id,
		label: c.title,
		hash: contentHash(c)
	});
	for (const f of p.figures) out.push({
		key: `figure:${f.id}`,
		kind: "figure",
		id: f.id,
		label: f.label,
		hash: contentHash(f)
	});
	for (const s of p.sections) for (const para of s.paragraphs) out.push({
		key: `paragraph:${para.id}`,
		kind: "paragraph",
		id: para.id,
		label: `${s.heading} · ${para.text.slice(0, 40)}`,
		hash: contentHash(para.text)
	});
	return out;
}
/** reviewed = matches what the author confirmed; changed = confirmed once, edited since; new = never confirmed. */
function reviewStatus(p, st) {
	const out = {};
	for (const u of units(p)) {
		const r = st.reviewed[u.key];
		out[u.key] = !r ? "new" : r.hash === u.hash ? "reviewed" : "changed";
	}
	return out;
}
/**
* Where skeleton and prose disagree: a paragraph written from an older version of its claim, a paragraph citing
* a removed claim, or (once drafting starts) a claim no paragraph states.
*/
function syncIssues(p) {
	const claims = new Map(p.claims.map((c) => [c.id, c]));
	const out = [];
	const stated = /* @__PURE__ */ new Set();
	for (const s of p.sections) for (const para of s.paragraphs) for (const cid of para.claims) {
		stated.add(cid);
		const c = claims.get(cid);
		if (!c) out.push({
			paragraph: para.id,
			section: s.id,
			claim: cid,
			kind: "claim-missing"
		});
		else if (para.basis[cid] !== claimHash(c)) out.push({
			paragraph: para.id,
			section: s.id,
			claim: cid,
			kind: "claim-changed"
		});
	}
	if (p.sections.some((s) => s.paragraphs.length)) {
		for (const c of p.claims) if (!stated.has(c.id)) out.push({
			paragraph: "",
			section: "",
			claim: c.id,
			kind: "unwritten"
		});
	}
	return out;
}
/** Numbers as written in prose: 4,321 / 0.0056 / 71% / 2.72; years and figure labels are ignored. */
const NUMBER = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+\.\d+|\d+)(\s?%)?(?![\w])/g;
const normalize = (s) => s.replace(/,/g, "").replace(/\s/g, "");
/**
* Numbers in claims, evidence and prose that the registry does not contain. Small integers (≤ 20, often counts
* like "three stages"), years 1900–2100, citation brackets [38–42] and figure/panel references are skipped; the check is a pointer for
* the author, not a proof.
*/
function unregisteredNumbers(p) {
	const known = new Set(p.numbers.flatMap((n) => [normalize(n.value), normalize(n.value).replace(/%$/, "")]));
	const ignored = new Set(p.numberIgnores);
	const out = [];
	const scan = (where, s) => {
		const cleaned = s.replace(/\[[\d,\s–-]+\]/g, " ").replace(/\b(?:Fig(?:ure)?s?\.?|ED Fig\.?|Table|Figure S)\s?S?\d+[A-Za-z]?\b/gi, " ").replace(/\bS\d+[A-Za-z]?\b/g, " ");
		for (const m of cleaned.matchAll(NUMBER)) {
			const raw = (m[1] ?? "") + (m[2] ?? "");
			const v = normalize(raw), bare = v.replace(/%$/, "");
			const n = Number(bare);
			if (!m[2] && Number.isInteger(n) && (n <= 20 || n >= 1900 && n <= 2100)) continue;
			if (known.has(v) || known.has(bare) || ignored.has(raw.trim()) || ignored.has(`${where}|${raw.trim()}`)) continue;
			const at = m.index ?? 0;
			out.push({
				where,
				value: raw.trim(),
				quote: cleaned.slice(Math.max(0, at - 30), at + raw.length + 30).trim()
			});
		}
	};
	for (const c of p.claims) {
		scan(`claim:${c.id}`, c.statement);
		for (const e of c.evidence) scan(`claim:${c.id}`, e.text);
	}
	for (const s of p.sections) for (const para of s.paragraphs) scan(`paragraph:${para.id}`, para.text);
	return out;
}
/** Advice for leaving a stage. The author may advance anyway; the list says what will be carried forward. */
function stageChecklist(p, st, stage = p.stage) {
	const open = st.comments.filter((c) => c.status === "open");
	const status = reviewStatus(p, st);
	const count = (prefix, s) => Object.entries(status).filter(([k, v]) => k.startsWith(prefix) && v === s).length;
	const core = p.claims.filter((c) => c.role === "core");
	const items = [];
	if (stage === "materials") {
		items.push({
			label: "已登记材料",
			ok: p.materials.length > 0,
			detail: `${p.materials.length} 份`
		});
		items.push({
			label: "目标读者与期刊",
			ok: !!p.audience && !!p.journal,
			detail: [p.journal, p.audience].filter(Boolean).join(" · ") || "未填写"
		});
	}
	if (stage === "skeleton" || stage === "refine") {
		items.push({
			label: "核心论点",
			ok: !!p.thesis.statement,
			detail: p.thesis.title || "未写"
		});
		const empty = p.beats.filter((b) => !b.claims.length);
		items.push({
			label: "每一拍都有分论点",
			ok: p.beats.length > 0 && !empty.length,
			detail: empty.length ? `${empty.length} 拍没有分论点` : `${p.beats.length} 拍`
		});
	}
	if (stage === "refine") {
		const weak = core.filter((c) => !c.evidence.some((e) => e.kind === "support" && e.status === "sufficient"));
		items.push({
			label: "核心分论点都有充足的支持论据",
			ok: !weak.length,
			detail: weak.length ? weak.map((c) => c.id).join("、") : `${core.length} 个核心分论点`
		});
		const gaps = p.claims.flatMap((c) => c.evidence.filter((e) => e.kind === "gap"));
		items.push({
			label: "缺口都有负责人",
			ok: gaps.every((g) => !!g.owner),
			detail: `${gaps.length} 个缺口，${gaps.filter((g) => !g.owner).length} 个无人负责`
		});
		const used = new Set(p.claims.flatMap((c) => c.evidence.flatMap((e) => e.panels.map((pn) => `${pn.figure}/${pn.label}`))));
		const orphan = p.figures.flatMap((f) => f.panels.filter((pn) => !pn.spare && !used.has(`${f.id}/${pn.label}`)).map((pn) => `${f.label}${pn.label}`));
		items.push({
			label: "每个面板都有论据引用或标为备用",
			ok: !orphan.length,
			detail: orphan.length ? `${orphan.length} 个面板无引用` : "全部有归属"
		});
		const unplaced = p.figures.filter((f) => f.placement === "unplaced");
		items.push({
			label: "每张图已定主图或扩展数据",
			ok: !unplaced.length,
			detail: unplaced.length ? unplaced.map((f) => f.label).join("、") : `${p.figures.length} 张`
		});
	}
	if (stage === "draft" || stage === "read") {
		const sync = syncIssues(p);
		items.push({
			label: "正文与骨架同步",
			ok: !sync.length,
			detail: sync.length ? `${sync.length} 处不同步` : "全部同步"
		});
		const nums = unregisteredNumbers(p).filter((n) => n.where.startsWith("paragraph:"));
		items.push({
			label: "正文数字都有出处",
			ok: !nums.length,
			detail: nums.length ? `${nums.length} 个数字不在登记表` : "全部登记"
		});
	}
	if (stage === "read" || stage === "submit") items.push({
		label: "段落都已审",
		ok: count("paragraph:", "reviewed") > 0 && count("paragraph:", "new") + count("paragraph:", "changed") === 0,
		detail: `${count("paragraph:", "reviewed")} 已审 · ${count("paragraph:", "changed")} 审后有修改 · ${count("paragraph:", "new")} 未审`
	});
	const human = open.filter((c) => c.source === "author" || c.source === "collaborator" || c.source === "chat" || c.source === "check").length;
	items.push({
		label: "意见都已处理",
		ok: !open.length,
		detail: open.length ? `人的意见 ${human} 条、模拟审阅 ${open.length - human} 条未处理` : "没有未处理意见"
	});
	return items;
}
/** Unit keys a change touches; used for history and "changed since review". */
function changedUnits(change) {
	switch (change.op) {
		case "set-meta":
		case "set-links":
		case "ignore-number": return [];
		case "set-thesis": return ["thesis"];
		case "upsert-beat": return [`beat:${change.beat.id}`];
		case "upsert-claim": return [`claim:${change.claim.id}`];
		case "upsert-figure": return [`figure:${change.figure.id}`];
		case "upsert-number": return [];
		case "upsert-section": return change.section.paragraphs.map((x) => `paragraph:${x.id}`);
		case "upsert-paragraph": return [`paragraph:${change.paragraph.id}`];
		case "remove": return change.unit === "number" || change.unit === "section" ? [] : [`${change.unit}:${change.id}`];
	}
}
function upsert(list, item, index) {
	const at = list.findIndex((x) => x.id === item.id);
	if (at >= 0) return list.map((x, i) => i === at ? item : x);
	const copy = [...list];
	copy.splice(index ?? copy.length, 0, item);
	return copy;
}
/**
* Apply changes to a copy of the project. Throws on references to unknown sections so a bad agent call fails
* whole instead of half-applying. A paragraph written without an explicit basis records the current claims.
*/
function applyChanges(p, changes) {
	let next = structuredClone(p);
	for (const ch of changes) switch (ch.op) {
		case "set-meta":
			next = {
				...next,
				...Object.fromEntries(Object.entries(ch.fields).filter(([, v]) => v !== void 0))
			};
			break;
		case "set-thesis":
			next.thesis = ch.thesis;
			break;
		case "upsert-beat":
			next.beats = upsert(next.beats, ch.beat, ch.index);
			break;
		case "upsert-claim":
			next.claims = upsert(next.claims, ch.claim);
			break;
		case "upsert-figure": {
			const old = next.figures.find((f) => f.id === ch.figure.id);
			const fig = old ? {
				...ch.figure,
				file: ch.figure.file || old.file,
				panels: ch.figure.panels.map((pn) => ({
					...pn,
					image: pn.image || old.panels.find((x) => x.label === pn.label)?.image || ""
				}))
			} : ch.figure;
			next.figures = upsert(next.figures, fig);
			break;
		}
		case "upsert-number":
			next.numbers = upsert(next.numbers, ch.number);
			break;
		case "upsert-section": {
			const claimsNow = new Map(next.claims.map((c) => [c.id, claimHash(c)]));
			const section = {
				...ch.section,
				paragraphs: ch.section.paragraphs.map((x) => ({
					...x,
					basis: {
						...Object.fromEntries(x.claims.flatMap((cid) => claimsNow.has(cid) ? [[cid, claimsNow.get(cid)]] : [])),
						...x.basis
					}
				}))
			};
			next.sections = upsert(next.sections, section, ch.index);
			break;
		}
		case "upsert-paragraph": {
			const s = next.sections.find((x) => x.id === ch.section);
			if (!s) throw new Error(`unknown section ${ch.section}`);
			const para = {
				...ch.paragraph,
				basis: { ...ch.paragraph.basis }
			};
			for (const cid of para.claims) {
				const c = next.claims.find((x) => x.id === cid);
				if (c && !para.basis[cid]) para.basis[cid] = claimHash(c);
			}
			const at = s.paragraphs.findIndex((x) => x.id === para.id);
			if (at >= 0) s.paragraphs[at] = para;
			else {
				const after = ch.after ? s.paragraphs.findIndex((x) => x.id === ch.after) : -1;
				s.paragraphs.splice(after >= 0 ? after + 1 : s.paragraphs.length, 0, para);
			}
			break;
		}
		case "remove":
			if (ch.unit === "paragraph") for (const s of next.sections) s.paragraphs = s.paragraphs.filter((x) => x.id !== ch.id);
			else if (ch.unit === "beat") next.beats = next.beats.filter((x) => x.id !== ch.id);
			else if (ch.unit === "claim") {
				next.claims = next.claims.filter((x) => x.id !== ch.id);
				next.beats = next.beats.map((b) => ({
					...b,
					claims: b.claims.filter((x) => x !== ch.id)
				}));
			} else if (ch.unit === "figure") next.figures = next.figures.filter((x) => x.id !== ch.id);
			else if (ch.unit === "number") next.numbers = next.numbers.filter((x) => x.id !== ch.id);
			else next.sections = next.sections.filter((x) => x.id !== ch.id);
			break;
		case "set-links":
			next.links = ch.links;
			break;
		case "ignore-number": {
			const key = ch.where ? `${ch.where}|${ch.value}` : ch.value;
			if (!next.numberIgnores.includes(key)) next.numberIgnores = [...next.numberIgnores, key];
			break;
		}
	}
	return next;
}
/** Mark a paragraph as rewritten from the current claims (after the author accepts it as in sync). */
function resyncBasis(p, paragraphId) {
	const next = structuredClone(p);
	for (const s of next.sections) for (const para of s.paragraphs) if (para.id === paragraphId) for (const cid of para.claims) {
		const c = next.claims.find((x) => x.id === cid);
		if (c) para.basis[cid] = claimHash(c);
	}
	return next;
}
//#endregion
//#region src/project/store.ts
/**
* File-backed project store. The project lives in <root>/project.json (readable, diffable, the author's file);
* review state (comments, reviewed hashes, history) lives in <root>/.review/state.json with one snapshot per
* revision. Writes are atomic and serialized; the store is the only writer of both files.
*/
async function writeAtomic(path, value) {
	const tmp = `${path}.${randomUUID()}.tmp`;
	await writeFile(tmp, JSON.stringify(value, null, 1));
	await rename(tmp, path);
}
const now = () => (/* @__PURE__ */ new Date()).toISOString();
function paragraphText(p, id) {
	for (const s of p.sections) for (const x of s.paragraphs) if (x.id === id) return x.text;
}
var ProjectStore = class {
	root;
	queue = Promise.resolve();
	constructor(root) {
		this.root = root;
	}
	get projectPath() {
		return join(this.root, "project.json");
	}
	get statePath() {
		return join(this.root, ".review", "state.json");
	}
	/** Run one operation at a time so read-modify-write never interleaves. */
	serial(fn) {
		const run = this.queue.then(fn, fn);
		this.queue = run.catch(() => void 0);
		return run;
	}
	async load() {
		const project = ProjectSchema.parse(JSON.parse(await readFile(this.projectPath, "utf8")));
		let state;
		try {
			state = ReviewStateSchema.parse(JSON.parse(await readFile(this.statePath, "utf8")));
		} catch (err) {
			if (err.code !== "ENOENT") throw err;
			state = ReviewStateSchema.parse({});
		}
		return {
			project,
			state
		};
	}
	/** Create a project; refuses to overwrite an existing one. */
	async create(project) {
		return this.serial(async () => {
			await mkdir(join(this.root, ".review", "history"), { recursive: true });
			try {
				await readFile(this.projectPath);
				throw new Error("project already exists");
			} catch (err) {
				if (err.code !== "ENOENT") throw err;
			}
			const p = ProjectSchema.parse(project);
			const state = ReviewStateSchema.parse({ history: [{
				revision: 0,
				at: now(),
				actor: "system",
				reason: "创建项目",
				comments: [],
				units: []
			}] });
			await writeAtomic(join(this.root, ".review", "history", "r0.json"), p);
			await writeAtomic(this.projectPath, p);
			await writeAtomic(this.statePath, state);
			return this.derive(p, state);
		});
	}
	derive(project, state) {
		return {
			project,
			revision: state.revision,
			comments: state.comments,
			history: state.history,
			status: reviewStatus(project, state),
			units: units(project),
			reviewed: Object.fromEntries(Object.entries(state.reviewed).map(([k, v]) => [k, v.revision])),
			sync: syncIssues(project),
			numbers: unregisteredNumbers(project),
			checklist: stageChecklist(project, state),
			numberHints: state.numberHints,
			drafts: state.drafts.map((d) => d.status === "pending" && paragraphText(project, d.paragraph) !== d.before ? {
				...d,
				status: "stale"
			} : d)
		};
	}
	async view() {
		const { project, state } = await this.load();
		return this.derive(project, state);
	}
	/** A past revision of the project, for comparisons. */
	async revision(n) {
		return ProjectSchema.parse(JSON.parse(await readFile(join(this.root, ".review", "history", `r${n}.json`), "utf8")));
	}
	/**
	* Apply changes directly and record them: they show as "changed since review" until the author confirms them.
	* Responses mark the answered comments; the reason and actor go into history.
	*/
	async apply(input) {
		return this.serial(async () => {
			const changes = input.changes.map((c) => ChangeSchema.parse(c));
			if (!input.reason.trim()) throw new Error("a reason is required");
			const { project, state } = await this.load();
			const next = ProjectSchema.parse(applyChanges(project, changes));
			const revision = state.revision + 1;
			const answered = /* @__PURE__ */ new Set();
			for (const r of input.responses ?? []) {
				const c = state.comments.find((x) => x.id === r.comment);
				if (!c) continue;
				c.response = {
					text: r.text,
					revision,
					at: now()
				};
				if (c.status === "open") c.status = "answered";
				answered.add(c.id);
			}
			state.revision = revision;
			state.history.push({
				revision,
				at: now(),
				actor: input.actor,
				reason: input.reason,
				comments: [...answered],
				units: [...new Set(changes.flatMap(changedUnits))]
			});
			await writeAtomic(join(this.root, ".review", "history", `r${revision}.json`), next);
			await writeAtomic(this.projectPath, next);
			await writeAtomic(this.statePath, state);
			return this.derive(next, state);
		});
	}
	async addComment(input) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			const comment = CommentSchema.parse({
				id: `c${Date.now().toString(36)}${randomUUID().slice(0, 4)}`,
				...input,
				status: "open",
				createdAt: now(),
				stage: project.stage
			});
			state.comments.push(comment);
			await writeAtomic(this.statePath, state);
			return {
				view: this.derive(project, state),
				comment
			};
		});
	}
	/** Close, decline or reopen a comment. Only the author decides; the agent answers through apply(). */
	async setComment(id, status) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			const c = state.comments.find((x) => x.id === id);
			if (!c) throw new Error(`unknown comment ${id}`);
			c.status = status;
			await writeAtomic(this.statePath, state);
			return this.derive(project, state);
		});
	}
	async setAssignee(id, assignee) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			const c = state.comments.find((x) => x.id === id);
			if (!c) throw new Error(`unknown comment ${id}`);
			c.assignee = assignee.trim().slice(0, 80);
			await writeAtomic(this.statePath, state);
			return this.derive(project, state);
		});
	}
	/** Store the agent's sort of unregistered numbers (hints only). */
	async setNumberHints(hints) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			state.numberHints = {
				...state.numberHints,
				...hints
			};
			await writeAtomic(this.statePath, state);
			return this.derive(project, state);
		});
	}
	/** Mark units as reviewed at their current content. */
	async confirm(keys) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			const byKey = new Map(units(project).map((u) => [u.key, u]));
			for (const k of keys) {
				const u = byKey.get(k);
				if (u) state.reviewed[k] = {
					hash: u.hash,
					revision: state.revision,
					at: now()
				};
			}
			await writeAtomic(this.statePath, state);
			return this.derive(project, state);
		});
	}
	/**
	* Move to a stage. Entering "submit" with unmet checklist items needs a written reason, kept in history:
	* the checklist advises elsewhere, but submission is where skipping it must be a recorded decision.
	*/
	async setStage(stage, actor, reason = "") {
		const s = StageSchema.parse(stage);
		return this.serial(async () => {
			const { project, state } = await this.load();
			const unmet = s === "submit" ? stageChecklist(project, state, "read").filter((i) => !i.ok) : [];
			if (unmet.length && reason.trim().length < 10) throw new Error(`进入投稿前有 ${unmet.length} 项未完成，需要写明理由`);
			const next = {
				...project,
				stage: s
			};
			state.revision += 1;
			state.history.push({
				revision: state.revision,
				at: now(),
				actor,
				reason: unmet.length ? `进入阶段：${s}（未完成：${unmet.map((i) => i.label).join("、")}；理由：${reason.trim()}）` : `进入阶段：${s}`,
				comments: [],
				units: []
			});
			await writeAtomic(join(this.root, ".review", "history", `r${state.revision}.json`), next);
			await writeAtomic(this.projectPath, next);
			await writeAtomic(this.statePath, state);
			return this.derive(next, state);
		});
	}
	/** Record proposed paragraph rewrites; an earlier pending draft for the same paragraph is replaced. */
	async addDrafts(drafts) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			for (const d of drafts) {
				for (const old of state.drafts) if (old.paragraph === d.paragraph && old.status === "pending") old.status = "discarded";
				state.drafts.push(DraftSchema.parse({
					...d,
					id: `d${Date.now().toString(36)}${randomUUID().slice(0, 4)}`,
					createdAt: now(),
					status: "pending"
				}));
			}
			await writeAtomic(this.statePath, state);
			return this.derive(project, state);
		});
	}
	/**
	* Accept or discard a draft. Accepting replaces the paragraph only if it still reads as the draft's `before`,
	* and records the paragraph as written from the current claims.
	*/
	async decideDraft(id, accept, actor, edited) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			const d = state.drafts.find((x) => x.id === id);
			if (!d || d.status !== "pending") throw new Error("draft is not pending");
			if (!accept) {
				d.status = "discarded";
				await writeAtomic(this.statePath, state);
				return this.derive(project, state);
			}
			if (paragraphText(project, d.paragraph) !== d.before) throw new Error("the paragraph changed after this draft was made; ask for a new draft");
			const sec = project.sections.find((s) => s.paragraphs.some((x) => x.id === d.paragraph));
			const para = sec.paragraphs.find((x) => x.id === d.paragraph);
			const text = edited?.trim() || d.after;
			const next = ProjectSchema.parse(applyChanges(project, [{
				op: "upsert-paragraph",
				section: sec.id,
				paragraph: {
					...para,
					text,
					basis: {}
				}
			}]));
			const byAuthor = text !== d.after;
			d.status = "accepted";
			d.after = text;
			state.revision += 1;
			state.history.push({
				revision: state.revision,
				at: now(),
				actor,
				reason: `${byAuthor ? "修改后接受" : "接受"}段落改写：${d.reason}`,
				comments: d.comments,
				units: [`paragraph:${d.paragraph}`]
			});
			await writeAtomic(join(this.root, ".review", "history", `r${state.revision}.json`), next);
			await writeAtomic(this.projectPath, next);
			await writeAtomic(this.statePath, state);
			return this.derive(next, state);
		});
	}
	/** The claim as it was when a paragraph recorded `hash` (latest matching revision), for "still consistent?" checks. */
	async claimAt(claimId, hash) {
		const { state } = await this.load();
		for (let n = state.revision; n >= 0; n--) {
			let p;
			try {
				p = await this.revision(n);
			} catch {
				continue;
			}
			const c = p.claims.find((x) => x.id === claimId);
			if (c && claimHash(c) === hash) return c;
		}
		return null;
	}
	/**
	* Record which claims paragraphs state, without touching their text; the basis becomes the current claims.
	* Used when a project is initialised from an existing manuscript.
	*/
	async linkParagraphs(links, actor, reason) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			const next = structuredClone(project);
			const claims = new Map(next.claims.map((c) => [c.id, c]));
			const known = new Set(next.sections.flatMap((s) => s.paragraphs.map((x) => x.id)));
			const unknownParagraphs = Object.keys(links).filter((id) => !known.has(id));
			const unknownClaims = [...new Set(Object.values(links).flat().filter((id) => !claims.has(id)))];
			const units = [];
			for (const s of next.sections) for (const x of s.paragraphs) {
				const ids = links[x.id];
				if (!ids) continue;
				x.claims = [...new Set(ids.filter((id) => claims.has(id)))];
				x.basis = Object.fromEntries(x.claims.map((id) => [id, claimHash(claims.get(id))]));
				units.push(`paragraph:${x.id}`);
			}
			if (units.length) {
				state.revision += 1;
				state.history.push({
					revision: state.revision,
					at: now(),
					actor,
					reason,
					comments: [],
					units: []
				});
				await writeAtomic(join(this.root, ".review", "history", `r${state.revision}.json`), next);
				await writeAtomic(this.projectPath, next);
				await writeAtomic(this.statePath, state);
			}
			return {
				view: this.derive(next, state),
				unknownParagraphs,
				unknownClaims
			};
		});
	}
	/** The author accepts a paragraph as matching its current claims without rewriting it. */
	async markInSync(paragraphId, actor) {
		return this.serial(async () => {
			const { project, state } = await this.load();
			const next = resyncBasis(project, paragraphId);
			state.revision += 1;
			state.history.push({
				revision: state.revision,
				at: now(),
				actor,
				reason: `确认段落 ${paragraphId} 与论点一致`,
				comments: [],
				units: []
			});
			await writeAtomic(join(this.root, ".review", "history", `r${state.revision}.json`), next);
			await writeAtomic(this.projectPath, next);
			await writeAtomic(this.statePath, state);
			return this.derive(next, state);
		});
	}
};
//#endregion
//#region src/project/prompts.ts
/** Fixed reviewer roles. Each owns one question so their comments do not overlap. */
const PERSONAS = {
	editor: {
		name: "期刊编辑",
		brief: "You are a senior handling editor at the target journal. You decide whether the paper goes to review.",
		owns: "the story: is there one clear advance, does each beat earn its place, do the main figures carry the story, what should move to extended data or be cut, does the title and abstract promise only what the paper shows"
	},
	reviewer: {
		name: "领域审稿人",
		brief: "You are an expert reviewer in the field, fair but demanding, writing the report the authors will have to answer.",
		owns: "the evidence: is each claim supported at the strength stated, where is it overclaimed, which controls, baselines or alternative explanations are missing, are numbers consistent between claims, figures and text"
	},
	audience: {
		name: "目标读者",
		brief: "You are the intended reader: a researcher from a neighbouring field whose first language is not English, reading carefully but without the authors' background.",
		owns: "understanding: where you lose the thread, which terms are undefined, which sentences you had to read twice, which figure you could not read, what you would ask the authors over coffee"
	}
};
const PERSPECTIVE = `Throughout, look at the paper from three outside positions at once: the journal editor deciding whether the
story is worth the pages, the expert reviewer checking every claim against its evidence, and the intended reader who
must understand it on first reading. Write for them, not for the authors.`;
/** Plain, expert style: the author's standing requirement for prose. */
const DEFAULT_STYLE = `Write as a native-speaker expert in the field would for a top journal, but so that a reader whose first language is
not English reads it comfortably: one idea per sentence, subject and verb early, concrete nouns, defined terms,
no stacked modifiers, no idioms or rhetorical flourish, active voice where natural. Precise numbers with their unit
and denominator. Claims no stronger than their evidence.`;
/**
* The conversation message for a task when a tool-using agent (DSH) does the work. The agent reads the project with
* project_read and records results with the project_* tools; the store, not the prose of the reply, is the outcome.
*/
function agentTaskMessage(task, project, style) {
	const head = `Project: ${JSON.stringify(project)} (workspace-relative). Read it with project_read before acting; record every result with the project tools named below. Your chat reply is a short summary only: the project files are the outcome.

`;
	switch (task.kind) {
		case "persona": {
			const r = PERSONAS[task.persona];
			return `${head}${r.brief}\nYour job is ${r.owns}. Leave other questions to the other reviewers. Judge what exists at the project's current stage.${task.focus ? `\nFocus: ${task.focus}` : ""}\nSkip points already raised in open comments (project_read include comments).\nRecord at most 8 comments with project_comment, source "${task.persona}", each naming the problem, why it matters to you in your role and what would fix it; prefix a major point with 【主要】. Target the exact claim, evidence, figure or paragraph id; quote exact text where useful. Write comments in Chinese; keep quotes and technical terms in their language.`;
		}
		case "refine": return `${head}You are revising the argument and figure plan in answer to comments ${JSON.stringify(task.comments)}.\n${PERSPECTIVE}\nChange claims, evidence, beats and figures with project_apply (one call, with a one-sentence reason and a response for every comment, including when you change nothing). Do not invent results or numbers; a needed analysis becomes a "gap" evidence item. Responses describe only what this call changed, in the language of the comment. Do not edit prose with project_apply. If a changed claim leaves paragraphs out of sync (project_read include sync), propose rewrites with project_draft, linked to the same comments; the author accepts each.`;
		case "skeleton": return `${head}Draft the argument before any prose: one thesis, 5–9 beats in reading order, the claims that carry each beat, and for each claim its evidence (how / support / limit / gap, with status), figure panels where they exist, and every number with its source in the registry. Each evidence item is one thing: the method is a "how" item, each result a separate "support" item, each caveat a "limit" item, each missing analysis a "gap" item. Register numbers one value per entry, written as the text will write them, each with its source. Mark a claim core only if the thesis fails without it (most papers have 3–6). Prefer fewer, stronger claims. Read the registered materials first.\n${PERSPECTIVE}\nRecord it with project_apply and fix anything its warnings report.`;
		case "draft": return `${head}Write the section for beat ${JSON.stringify(task.beat)} from its claims.\n${PERSPECTIVE}\nStyle: ${style || DEFAULT_STYLE}\nState each claim at the strength its evidence supports; use only registered numbers, written exactly; cite panels as (Fig. 2b); answer each reviewerQuestion where a reader would ask it; no new claims. Record it with project_apply: one upsert-section (heading, beat) followed by upsert-paragraph changes, each listing the claim ids it states.`;
		case "resync": return `${head}The claims of paragraphs ${JSON.stringify(task.paragraphs)} changed after they were written. Propose rewrites that state the current claims, changing as little as possible.\n${PERSPECTIVE}\nStyle: ${style || DEFAULT_STYLE}\nRecord them with project_draft; never replace prose directly.`;
		case "numbers": return `${head}Sort every unregistered number (project_read include numbers) into result, parameter, citation or other, with a few-word Chinese note on what it is. Be conservative: when unsure between result and parameter, choose result. Record with project_number_hints. These are hints for the author, not decisions.`;
	}
}
//#endregion
//#region src/project/tools.ts
/**
* The model-facing project tools, independent of DSH: each takes the project's store, the tool arguments and the
* actor name, and returns the JSON the model reads. The DSH host registers them as tools; tests and other harnesses
* (a command-line bridge for other agents) call the same functions, so every model sees the same validation,
* warnings and next steps.
*/
/** The parts of a project view a model asks for; the whole view of a real paper is too large for one tool result. */
function modelView(v, include, ids) {
	const want = (k) => include.includes(k);
	const p = v.project;
	const pick = (xs) => ids.length ? xs.filter((x) => ids.includes(x.id)) : xs;
	return {
		title: p.title,
		journal: p.journal,
		audience: p.audience,
		stage: p.stage,
		thesis: p.thesis,
		revision: v.revision,
		beats: p.beats,
		claims: pick(p.claims),
		...want("figures") ? { figures: p.figures.map((f) => ({
			id: f.id,
			label: f.label,
			title: f.title,
			placement: f.placement,
			caption: f.caption.slice(0, 1500),
			panels: f.panels.map((x) => ({
				label: x.label,
				note: x.note,
				spare: x.spare
			}))
		})) } : {},
		...want("sections") ? { sections: p.sections.map((s) => ({
			id: s.id,
			heading: s.heading,
			beat: s.beat,
			paragraphs: s.paragraphs.filter((x) => !ids.length || ids.includes(x.id) || x.claims.some((c) => ids.includes(c))).map((x) => ({
				id: x.id,
				claims: x.claims,
				text: x.text
			}))
		})) } : {},
		...want("comments") ? { comments: v.comments.filter((c) => c.status === "open" || c.status === "answered").map((c) => ({
			id: c.id,
			source: c.source,
			author: c.author,
			target: c.target,
			text: c.text,
			status: c.status
		})) } : {},
		...want("numbers") ? {
			registry: p.numbers,
			unregistered: v.numbers
		} : {},
		...want("sync") ? {
			sync: v.sync,
			drafts: v.drafts.filter((d) => d.status === "pending").map((d) => ({
				id: d.id,
				paragraph: d.paragraph
			}))
		} : {},
		...want("materials") ? { materials: p.materials } : {}
	};
}
async function repoInfo(projectRoot) {
	try {
		const init = JSON.parse(await readFile(resolve(projectRoot, "init.json"), "utf8"));
		if (!init.repo?.path) return null;
		const ctx = JSON.parse(await readFile(resolve(projectRoot, "repo", "repo-context.json"), "utf8"));
		const manuscripts = Object.keys(init.inputs ?? {}).filter((k) => /\.(tex|md|docx|pdf|txt|html?)$/i.test(k));
		return {
			root: init.repo.path,
			manuscripts,
			candidates: [...(ctx.resultTables ?? []).map((t) => t.path), ...(ctx.docs ?? []).filter((d) => d.kind === "plan").map((d) => d.path)].slice(0, 12)
		};
	} catch {
		return null;
	}
}
/** Pre-computed matches of manuscript numbers in repository files (match_numbers.py), compacted for the model. */
async function numberMatches(projectRoot) {
	try {
		const m = JSON.parse(await readFile(resolve(projectRoot, "repo", "number-matches.json"), "utf8"));
		return {
			matched: m.matched.map((x) => ({
				value: x.value,
				paragraphs: x.paragraphs.slice(0, 4),
				quote: x.quote,
				candidates: x.candidates.slice(0, 3)
			})),
			notFoundInRepository: m.notFound.map((x) => x.value)
		};
	} catch {
		return "No number-matches.json: the project was not initialised with a repository.";
	}
}
/**
* Evidence and numbers whose source names no file in the repository. A tool-result warning is what makes agents
* cite the repository (the skill text alone did not: 1 of 22 numbers and no evidence in a live run).
*/
async function uncitedRepoSources(projectRoot, p) {
	const repo = await repoInfo(projectRoot);
	if (!repo) return null;
	const exists = async (src) => {
		for (const cand of src.match(/[\w./-]+\.(?:json|csv|tsv|md|txt|tex|py|r|R|ipynb|xlsx?)/g) ?? []) for (const full of [resolve(repo.root, cand), resolve(repo.root, "..", cand)]) {
			if (repo.manuscripts.includes(full)) continue;
			try {
				if ((await stat(full)).isFile()) return true;
			} catch {}
		}
		return false;
	};
	const ev = p.claims.flatMap((c) => c.evidence.filter((e) => e.kind === "support").map((e) => ({
		c: c.id,
		e
	})));
	let evMissing = 0;
	for (const { e } of ev) if (!await exists(e.source)) evMissing += 1;
	let numMissing = 0;
	for (const n of p.numbers) if (!await exists(n.source)) numMissing += 1;
	if (!evMissing && !numMissing) return null;
	let hint = "";
	try {
		const m = JSON.parse(await readFile(resolve(projectRoot, "repo", "number-matches.json"), "utf8"));
		const byValue = new Map(m.matched.map((x) => [x.value.replace(/,/g, ""), x.candidates[0]?.file]));
		const pairs = [];
		for (const n of p.numbers) if (!await exists(n.source)) {
			const f = byValue.get(n.value.replace(/,/g, ""));
			if (f) pairs.push(`${n.value} → ${f}`);
		}
		if (pairs.length) hint = ` Matches found by the pre-match (confirm before using): ${pairs.slice(0, 15).join("; ")}.`;
	} catch {}
	return `${evMissing} of ${ev.length} support evidence items and ${numMissing} of ${p.numbers.length} registered numbers do not cite a repository file.${hint} Where the result lives in the repository, set source to that file path relative to the repository (e.g. results/coverage.json), so the check can verify the value there; keep the manuscript section only when no repository file holds it. Result files and plans found: ${repo.candidates.join(", ") || "none"}.`;
}
async function readTool(store, args) {
	const view = modelView(await store.view(), args.include ?? [], args.ids ?? []);
	if ((args.include ?? []).includes("numberMatches")) view.numberMatches = await numberMatches(store.root);
	return JSON.parse(JSON.stringify(view));
}
async function applyTool(store, args, actor) {
	const raw = Array.isArray(args.changes) ? args.changes : [];
	const rejected = [];
	const changes = raw.flatMap((c, index) => {
		const r = ChangeSchema.safeParse(c);
		if (r.success) return [r.data];
		const o = c ?? {};
		const unit = Object.values(o).find((x) => typeof x === "object" && x !== null && "id" in x);
		rejected.push({
			index,
			op: String(o.op ?? "?"),
			id: String(unit?.id ?? ""),
			error: r.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
		});
		return [];
	});
	if (!changes.length) return {
		written: 0,
		rejected,
		nextStep: "Nothing was written. Fix the rejected changes and send them again."
	};
	const v = await store.apply({
		changes,
		actor,
		reason: String(args.reason),
		responses: z.array(z.object({
			comment: z.string(),
			text: z.string().max(4e3)
		})).default([]).parse(args.responses)
	});
	const h = v.history.at(-1);
	const warnings = [];
	const touched = new Set(h.units.filter((u) => u.startsWith("claim:")).map((u) => u.slice(6)));
	const multi = changes.flatMap((c) => c.op === "upsert-number" && (c.number.value.match(/\d[\d,.]*/g) ?? []).length > 1 && !/^[\d,.]+%?\s*[–-]\s*[\d,.]+%?$/.test(c.number.value.trim()) ? [c.number.id] : []);
	if (multi.length) warnings.push(`Numbers ${multi.join(", ")} hold several values; register one value per entry so prose can be checked against it.`);
	const thin = v.project.claims.filter((c) => touched.has(c.id) && c.evidence.filter((e) => e.kind === "support").length < 2);
	if (thin.length) warnings.push(`Claims ${thin.map((c) => c.id).join(", ")} have fewer than two support items; give each result the claim rests on its own support item (with its panel), and keep method (how), caveats (limit) and missing analyses (gap) separate.`);
	const loose = v.numbers.filter((n) => !n.where.startsWith("paragraph:") && touched.has(n.where.replace(/^claim:/, "")));
	if (loose.length) warnings.push(`${loose.length} numbers in these claims and their evidence are not registered (e.g. ${[...new Set(loose.map((n) => n.value))].slice(0, 8).join(", ")}); register each with its source.`);
	if (v.project.claims.length >= 3 && !v.project.claims.some((c) => c.role === "core")) warnings.push("No claim is marked core; mark the claims the thesis cannot stand without.");
	const thesisTitle = v.project.thesis.title.trim();
	if (changes.some((c) => c.op === "set-thesis") && (/^(核心)?论点$|^主论点$|^thesis$|^main claim$/i.test(thesisTitle) || thesisTitle.length < 6)) warnings.push(`The thesis title "${thesisTitle}" is a label, not the finding; give it a short title that states the finding itself.`);
	const uncited = await uncitedRepoSources(store.root, v.project);
	if (uncited) warnings.push(uncited);
	const changedClaims = new Set(h.units.filter((u) => u.startsWith("claim:")).map((u) => u.slice(6)));
	const stale = [...new Set(v.sync.filter((s) => s.kind === "claim-changed" && changedClaims.has(s.claim)).map((s) => s.paragraph))].filter((id) => !v.drafts.some((d) => d.paragraph === id && d.status === "pending"));
	return {
		revision: v.revision,
		changed: h.units,
		answered: h.comments,
		outOfSync: stale,
		...warnings.length ? { warnings } : {},
		...rejected.length ? {
			rejected,
			fix: `${rejected.length} changes were rejected and not written; the others were. Fix and resend only the rejected ones.`
		} : {},
		...stale.length ? { nextStep: `These ${stale.length} paragraphs still state the old claims: ${stale.join(", ")}. Before finishing, read them (project_read include sections, ids) and call project_draft with minimal rewrites that state the current claims, comments: ${JSON.stringify(h.comments)}.` } : {}
	};
}
async function commentTool(store, args) {
	const list = z.array(z.object({
		source: z.enum([
			"editor",
			"reviewer",
			"audience",
			"check"
		]),
		target: TargetSchema,
		text: CommentSchema.shape.text
	})).max(30).parse(args.comments);
	const names = {
		editor: "期刊编辑",
		reviewer: "领域审稿人",
		audience: "目标读者",
		check: "初始化检查"
	};
	const existing = new Set((await store.view()).comments.map((c) => `${c.source}|${c.target.kind}|${c.target.id}|${c.text.slice(0, 80)}`));
	let recorded = 0;
	for (const c of list) {
		const key = `${c.source}|${c.target.kind}|${c.target.id}|${c.text.slice(0, 80)}`;
		if (existing.has(key)) continue;
		existing.add(key);
		await store.addComment({
			target: c.target,
			source: c.source,
			author: `${names[c.source]}（agent）`,
			text: c.text
		});
		recorded += 1;
	}
	return {
		recorded,
		skippedDuplicates: list.length - recorded
	};
}
async function draftTool(store, args, actor) {
	const list = z.array(z.object({
		paragraph: z.string(),
		text: z.string().min(1).max(2e4),
		reason: z.string().max(2e3),
		comments: z.array(z.string()).default([])
	})).max(40).parse(args.drafts);
	const v = await store.view();
	const drafts = list.map((d) => {
		const s = v.project.sections.find((x) => x.paragraphs.some((p) => p.id === d.paragraph));
		if (!s) throw new Error(`unknown paragraph ${d.paragraph}`);
		const para = s.paragraphs.find((p) => p.id === d.paragraph);
		return {
			section: s.id,
			paragraph: para.id,
			before: para.text,
			after: d.text,
			claims: para.claims,
			reason: d.reason,
			actor,
			comments: d.comments
		};
	});
	await store.addDrafts(drafts);
	return { proposed: drafts.length };
}
async function linkTool(store, args, actor) {
	const links = z.record(z.string(), z.array(z.string())).parse(args.links);
	const r = await store.linkParagraphs(links, actor, String(args.reason ?? "把段落对应到分论点"));
	const paras = r.view.project.sections.flatMap((s) => s.paragraphs);
	const stated = new Set(paras.flatMap((x) => x.claims));
	const pj = r.view.project, warnings = [];
	const linked = paras.filter((x) => x.claims.length);
	const emptyBeats = pj.beats.filter((b) => !b.claims.length).map((b) => b.id);
	if (emptyBeats.length) warnings.push(`Beats ${emptyBeats.join(", ")} have no claim; every beat needs at least one.`);
	if (pj.claims.length && linked.length / pj.claims.length > 6) warnings.push(`${linked.length} paragraphs state only ${pj.claims.length} claims; findings were probably merged. Split claims to the grain of a results subsection or figure.`);
	if (pj.claims.length >= 3 && pj.claims.every((c) => c.role === "core")) warnings.push("Every claim is core; keep core for the claims the thesis cannot stand without.");
	const resultNumbers = r.view.numbers.filter((n) => n.where.startsWith("paragraph:") && linked.some((x) => `paragraph:${x.id}` === n.where));
	if (resultNumbers.length > pj.numbers.length) warnings.push(`${resultNumbers.length} numbers in paragraphs that state claims are not registered (e.g. ${resultNumbers.slice(0, 8).map((n) => n.value).join(", ")}); register the findings among them (one value per entry) with project_apply.`);
	const uncited = await uncitedRepoSources(store.root, pj);
	if (uncited) warnings.push(uncited);
	return {
		linked: Object.keys(links).length - r.unknownParagraphs.length,
		unknownParagraphs: r.unknownParagraphs,
		unknownClaims: r.unknownClaims,
		paragraphsWithoutClaims: paras.filter((x) => !x.claims.length).length,
		claimsStatedByNoParagraph: pj.claims.filter((c) => !stated.has(c.id)).map((c) => c.id),
		...warnings.length ? { warnings } : {}
	};
}
async function numberHintsTool(store, args) {
	const list = z.array(z.object({
		key: z.string(),
		kind: z.enum([
			"result",
			"parameter",
			"citation",
			"other"
		]),
		note: z.string().max(400).default("")
	})).parse(args.hints);
	await store.setNumberHints(Object.fromEntries(list.map((h) => [h.key, {
		kind: h.kind,
		note: h.note
	}])));
	return { recorded: list.length };
}
//#endregion
//#region src/project/init-job.ts
/** Pages per batch and words per batch: small enough that a turn finishes them, large enough to keep turns few. */
const PAGES_PER_BATCH = 4;
const WORDS_PER_BATCH = 1800;
/**
* Batches in reading order. A PDF is split by pages; LaTeX, Word and Markdown by the top-level headings of the
* outline the preparation script wrote, two sections a batch, the last running to the end.
*/
function planBatches(kind, pageWords, outline, skip = []) {
	if (kind === "pdf") {
		const out = [];
		let start = 0, words = 0;
		const close = (end) => {
			if (!start) return;
			const span = start === end ? `${end}` : `${start}–${end}`;
			const files = start === end ? `reading/pages/p${pad(end)}.png` : `reading/pages/p${pad(start)}.png … p${pad(end)}.png`;
			out.push({
				label: `第 ${span} 页`,
				part: `${start === end ? "page" : "pages"} ${span} (${files})`
			});
			start = 0;
			words = 0;
		};
		pageWords.forEach((w, i) => {
			const page = i + 1;
			if (skip[i]) {
				close(page - 1);
				return;
			}
			if (!start) start = page;
			words += w;
			if (page - start + 1 >= PAGES_PER_BATCH || words >= WORDS_PER_BATCH || page === pageWords.length) close(page);
		});
		return out;
	}
	const heads = outline.split("\n").map((l) => /^- (?:section|heading): (.+)$/.exec(l)?.[1]?.trim()).filter((h) => Boolean(h));
	if (!heads.length) return [{
		label: "全文",
		part: "the whole manuscript"
	}];
	const out = [];
	for (let i = 0; i < heads.length; i += 2) {
		const first = i === 0 ? "the title, author block and abstract, then the section" : "the section";
		const end = i + 2 < heads.length ? `up to (not including) the section "${heads[i + 2]}"` : "to the end of the manuscript, appendix included (not the reference list)";
		out.push({
			label: `“${short(heads[i])}”起`,
			part: `${first} "${heads[i]}" ${i + 1 < heads.length ? `and the section "${heads[i + 1]}" ` : ""}${end}`
		});
	}
	return out;
}
const REFERENCE_LINE = /(et al\.|arXiv preprint|In Proceedings|Proceedings of|Conference on|Journal of|doi:|https?:\/\/|\(\d{4}\)|, \d{4}[a-z]?\.)/;
/**
* Pages of the reference list, by position: after the page with a "References" / "Bibliography" heading line, up to
* the first page that starts the appendix or supplement, and only pages whose lines mostly look like citations.
* Related-work pages are full of "et al." too, so a citation-density rule alone would skip them.
* Same rule as check_project.py.
*/
function referencePages(pages) {
	const out = pages.map(() => false);
	const start = pages.findIndex((t) => /^\s*(References|Bibliography|Literature Cited|参考文献)\s*$/m.test(t));
	if (start < 0) return out;
	for (let i = start + 1; i < pages.length; i++) {
		const t = pages[i];
		if (/^\s*(Appendix|Appendices|Supplementary (Information|Material|Methods)|Table of Contents|A\.?\s+[A-Z][a-z])/m.test(t.split("\n").slice(0, 12).join("\n"))) break;
		const lines = t.split("\n").filter((l) => l.trim());
		if (lines.length && lines.filter((l) => REFERENCE_LINE.test(l)).length / lines.length > .25) out[i] = true;
	}
	return out;
}
const pad = (n) => String(n).padStart(3, "0");
const short = (s) => s.length > 18 ? `${s.slice(0, 17)}…` : s;
function copyState(project) {
	const sections = project.sections ?? [];
	const last = sections.at(-1);
	const para = [...sections].reverse().find((x) => x.paragraphs.length)?.paragraphs.at(-1);
	return {
		paragraphs: sections.reduce((n, s) => n + s.paragraphs.length, 0),
		figures: (project.figures ?? []).length,
		...last ? { lastSection: {
			id: last.id,
			heading: last.heading
		} } : {},
		...para ? { lastParagraph: {
			id: para.id,
			tail: para.text.slice(-80)
		} } : {}
	};
}
const TOOLS = "Use only the paper-project-init scripts (page_tools.py grid/crop, check_project.py), read_image and the project_* tools; never the paper_* tools or the paper-figure-panels skill, which are for manuscript review.";
const RULES = "Look at each page with read_image (or read the source) and copy its text yourself in the project format of the skill; never paste extracted text. Find every figure and table on these pages by looking, cut it on the coordinate grid, look at the crop, cut its panels and look at each.";
/** The message that starts the job: preparation only, so the turn is short and the panel can plan the batches. */
function prepareMessage(lines) {
	return [
		"Initialise a paper project with the paper-project-init skill. The Paper panel drives this work in rounds and sends the next round when you end your turn.",
		"",
		...lines,
		"",
		"This round: step 1 only. Run init_project.py with these inputs, set the title (and journal/audience if the manuscript shows them) with project_apply set-meta, and read reading/outline.md. Do not copy any text yet. End your turn with one line saying the project is prepared and how many pages or sections it has."
	].join("\n");
}
function copyMessage(project, batch, round, rounds, state, retry) {
	const where = state.lastSection ? `So far the project has ${state.paragraphs} paragraphs and ${state.figures} figures and ends with section ${state.lastSection.id} "${state.lastSection.heading}"` + (state.lastParagraph ? `; the last paragraph is ${state.lastParagraph.id}, ending "…${state.lastParagraph.tail}"` : "") + ". Continue from there: if the first page of this batch begins in the middle of that paragraph, extend it (upsert-paragraph, same id, the joined text); a new heading starts a new section with the next id. Figures already recorded (see project_read include figures) are not cut again." : "Nothing is copied yet: start with the title block and abstract (section s1).";
	return [
		`${retry ? "Nothing was recorded in the last round. " : ""}Paper project ${JSON.stringify(project)}, copying round ${round} of ${rounds}: copy ${batch.part}, following steps 2 and 3 of the paper-project-init skill for this part only.`,
		RULES,
		TOOLS,
		where,
		"If the last paragraph of this part continues beyond it, look at the next page and copy that paragraph to its end. Record sections and paragraphs with project_apply as you go, and each figure with upsert-figure once its panels are cut.",
		"Do nothing else in this round (no claims, no check). Do not ask the user anything: if the pages and this message disagree, follow the pages and say so in your summary. End your turn with one line: what you recorded."
	].join("\n\n");
}
function argumentMessage(project, withRepo) {
	return [`Paper project ${JSON.stringify(project)}: all text and figures are copied. Now do steps 4 and 5 of the paper-project-init skill: ` + (withRepo ? "run match_numbers.py first, then reconstruct the argument with the repository, " : "reconstruct the argument, ") + "linking every evidence item to the figure panel that shows it (look at the panel), then link every paragraph to the claims it states.", "Write thesis, beat and claim titles and statements in Chinese (the author's working language); keep quotes, numbers and technical terms as in the paper. Do not ask the user anything in this round; note open questions as gap evidence or in your summary. End your turn with one line: what you built."].join("\n\n");
}
/**
* The check's errors as lines for the next round, one line per kind of problem: the same guidance repeated for twenty
* paragraphs made an 8 KB message; grouped, each kind lists its places once and its guidance once.
*/
function errorLines(findings) {
	const errors = (Array.isArray(findings) ? findings : []).filter((f) => f.severity === "error");
	const groups = /* @__PURE__ */ new Map();
	for (const f of errors) {
		const m = /^(格式：)?(\S+) (有|段落|页眉|单词|正文|图注)(.*)$/.exec(f.title ?? "");
		const kind = m ? `${m[1] ?? ""}${m[3]}${m[4]}` : f.title ?? "";
		const key = `${kind}|${f.guidance ?? ""}`;
		const g = groups.get(key) ?? {
			kind,
			guidance: f.guidance ?? "",
			items: []
		};
		g.items.push(m ? `${m[2]}${f.detail ? ` ${f.detail}` : ""}` : f.detail ?? "");
		groups.set(key, g);
	}
	return [...groups.values()].slice(0, 20).map((g) => {
		const places = g.items.filter(Boolean);
		return [
			g.kind,
			places.length ? places.slice(0, 25).join("; ") + (places.length > 25 ? `; … (${places.length} in all)` : "") : "",
			g.guidance
		].filter(Boolean).join(" — ");
	});
}
function checkMessage(project, errors = []) {
	if (errors.length) return [
		`Paper project ${JSON.stringify(project)}: the check still reports ${errors.length} error${errors.length > 1 ? "s" : ""}. Fix each one now; do not only report them.`,
		errors.map((e, i) => `${i + 1}. ${e}`).join("\n"),
		TOOLS,
		"For a crop: look at the page on its grid again (page_tools.py grid), choose a better box, cut it again under the same file name (page_tools.py crop), and look at the result; for panels, grid the figure crop, cut each panel to assets/<figure id><label>.png and update the figure with upsert-figure. For text: look at the page again and correct the paragraph (same id). Then run check_project.py again, record any remaining findings with project_comment (source \"check\"), and give the author the four-part report the skill describes. Do not ask the user anything in this round."
	].join("\n\n");
	return [`Paper project ${JSON.stringify(project)}: do step 6 of the paper-project-init skill. Run check_project.py; while it exits with status 1, go back to the pages it names, look again, and fix the copy or the figures, then run it again.`, "Then record the remaining findings and your own list of problems with project_comment (source \"check\"), and give the author the four-part report the skill describes. Do not ask the user anything in this round."].join("\n\n");
}
//#endregion
//#region src/project-host.ts
/** Model tools of project mode; available in every conversation, each names its project directory. */
const PROJECT_TOOLS = [
	"project_read",
	"project_apply",
	"project_comment",
	"project_draft",
	"project_number_hints",
	"project_link_paragraphs"
];
const IMAGE_TYPES = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml"
};
const MAX_ASSET_BYTES = 8e6;
const TaskSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("skeleton") }),
	z.object({
		kind: z.literal("persona"),
		persona: z.enum([
			"editor",
			"reviewer",
			"audience"
		]),
		focus: z.string().max(2e3).default("")
	}),
	z.object({
		kind: z.literal("refine"),
		comments: z.array(z.string()).min(1).max(20)
	}),
	z.object({
		kind: z.literal("draft"),
		beat: z.string()
	}),
	z.object({
		kind: z.literal("resync"),
		paragraphs: z.array(z.string()).min(1).max(40)
	}),
	z.object({ kind: z.literal("numbers") })
]);
/** Fields of the panel's initialisation form, as workspace-relative paths. */
const InitFormSchema = z.object({
	source: z.string().max(1e3).default(""),
	figures: z.string().max(1e3).default(""),
	notes: z.string().max(1e3).default(""),
	repo: z.string().max(1e3).default(""),
	output: z.string().max(300).default("")
});
/** Real location of a path that may not exist yet: the real path of its nearest existing ancestor, plus the rest. */
async function realTarget(path) {
	let head = path;
	const tail = [];
	for (;;) {
		try {
			return resolve(await realpath(head), ...tail.reverse());
		} catch {}
		const up = dirname(head);
		if (up === head) return path;
		tail.push(head.slice(up.length).replace(/^[\\/]/, ""));
		head = up;
	}
}
const within = (root, p) => {
	const r = relative(root, p);
	return r === "" || !r.startsWith("..") && !isAbsolute(r);
};
/**
* Checks the initialisation form before anything is handed to the agent, so the author sees a wrong path in the panel
* instead of in a failed agent turn. Symlinks are followed: a path that resolves outside the workspace is refused.
*/
async function checkInit(root, form) {
	const problems = [];
	const kind = async (p) => {
		try {
			return (await stat(p)).isDirectory() ? "dir" : "file";
		} catch {
			return null;
		}
	};
	const real = {};
	for (const field of [
		"source",
		"figures",
		"notes",
		"repo",
		"output"
	]) {
		if (!form[field].trim()) continue;
		const p = await realTarget(resolve(root, form[field].trim()));
		if (!within(root, p)) {
			problems.push({
				field,
				level: "error",
				message: "不在当前工作区内"
			});
			continue;
		}
		real[field] = p;
	}
	if (!form.source.trim()) problems.push({
		field: "source",
		level: "error",
		message: "请填写稿件路径"
	});
	for (const [field, expected, name] of [
		[
			"source",
			"file",
			"稿件"
		],
		[
			"figures",
			"dir",
			"图文件夹"
		],
		[
			"notes",
			"file",
			"意见文件"
		],
		[
			"repo",
			"dir",
			"研究仓库"
		]
	]) {
		const p = real[field];
		if (!p) continue;
		const k = await kind(p);
		if (!k) problems.push({
			field,
			level: "error",
			message: `找不到这个${name}`
		});
		else if (k !== expected) problems.push({
			field,
			level: "error",
			message: expected === "dir" ? "这是文件，需要一个文件夹" : "这是文件夹，需要一个文件"
		});
	}
	const out = real.output;
	if (form.output.trim() && out) if (out === root) problems.push({
		field: "output",
		level: "error",
		message: "不能直接用工作区根目录，请填一个新的子文件夹"
	});
	else if (await kind(out)) {
		const isProject = await kind(resolve(out, "project.json")) === "file";
		problems.push({
			field: "output",
			level: "error",
			message: isProject ? "这里已经是一个项目，可在上方直接打开；要重新初始化请换一个文件夹名" : "这个文件夹已经存在；新项目需要一个还不存在的文件夹"
		});
	} else for (const [field, name] of [
		["figures", "图文件夹"],
		["notes", "意见文件"],
		["source", "稿件"]
	]) {
		const p = real[field];
		if (p && (within(p, out) || within(out, p))) problems.push({
			field: "output",
			level: "warn",
			message: `和${name}的位置重叠；建议放到别处，免得新文件混进原始材料`
		});
	}
	else if (!form.output.trim()) problems.push({
		field: "output",
		level: "error",
		message: "请填写新项目文件夹"
	});
	return problems;
}
/** One level of a workspace directory for the panel's path browser; hidden entries are left out. */
async function browse(root, path) {
	const dir = await realTarget(resolve(root, path || "."));
	if (!within(root, dir)) throw new Error(`${path} is outside the conversation workspace`);
	const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith("."));
	const list = await Promise.all(entries.map(async (e) => ({
		name: e.name,
		dir: e.isDirectory() || e.isSymbolicLink() && await stat(resolve(dir, e.name)).then((s) => s.isDirectory(), () => false)
	})));
	list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
	return {
		path: relative(root, dir) || ".",
		entries: list.slice(0, 500)
	};
}
/**
* Register project mode.
* @param ctx - host plugin context (connection, tools, agents).
* @param rootFor - the conversation's workspace root, shared with manuscript review.
*/
function applyProject(ctx, rootFor) {
	const stores = /* @__PURE__ */ new Map();
	/** Session -> project directory last opened in the panel, the default for model tools. */
	const current = /* @__PURE__ */ new Map();
	const launches = /* @__PURE__ */ new Map();
	const jobs = /* @__PURE__ */ new Map();
	const SAVED = [
		"output",
		"withRepo",
		"phase",
		"batches",
		"index",
		"retried",
		"checkRounds",
		"before",
		"lastText",
		"note"
	];
	async function saveJob(job) {
		const file = resolve(job.root, job.output, "reading", "job.json");
		try {
			await stat(dirname(file));
		} catch {
			return;
		}
		await writeFile(file, JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, job[k]])), null, 1));
	}
	async function loadJob(sessionId, root, project) {
		const saved = await readJson(resolve(root, project, "reading", "job.json"));
		if (!saved || saved.phase === "done") return null;
		return {
			...saved,
			output: project,
			sessionId,
			root,
			sent: "",
			completed: false,
			paused: "初始化没有做完（DSH 重启过）"
		};
	}
	const readJson = async (path) => {
		try {
			return JSON.parse(await readFile(path, "utf8"));
		} catch {
			return null;
		}
	};
	function send(job, text) {
		const agent = ctx.agents.get(job.sessionId);
		if (!agent) {
			job.paused = "对话已关闭";
			return;
		}
		const message = createUserMessage({
			source: { kind: "user" },
			content: [{
				type: "text",
				text
			}]
		});
		job.sent = message.id;
		job.lastText = text;
		job.completed = false;
		agent.followup(message);
		saveJob(job).catch(() => {});
	}
	/** One round finished: check what it produced and send the next one. */
	async function advance(job) {
		const dir = resolve(job.root, job.output);
		if (job.phase === "prepare") {
			const init = await readJson(resolve(dir, "init.json"));
			if (!init) {
				job.phase = "done";
				job.note = "准备步骤没有完成，原因见对话";
				return;
			}
			const texts = Object.keys(init.reading?.text ?? {}).sort();
			const pages = await Promise.all(texts.filter((t) => /\/p\d+\.txt$/.test(t)).map((t) => readFile(resolve(dir, t), "utf8").catch(() => "")));
			const outline = await readFile(resolve(dir, "reading/outline.md"), "utf8").catch(() => "");
			job.batches = planBatches(String(init.reading?.kind ?? ""), pages.map((t) => t.split(/\s+/).filter(Boolean).length), outline, referencePages(pages));
			job.withRepo = Boolean(init.repo);
			job.phase = "copy";
			job.index = 0;
			job.retried = false;
		} else if (job.phase === "copy") {
			const state = copyState(await readJson(resolve(dir, "project.json")) ?? {});
			const before = job.before;
			if (before && state.paragraphs + state.figures <= before.paragraphs + before.figures) {
				if (job.retried) {
					job.paused = `${job.batches[job.index].label}没有抄进任何内容，初始化已暂停`;
					return;
				}
				job.retried = true;
				send(job, copyMessage(job.output, job.batches[job.index], job.index + 1, job.batches.length, before, true));
				return;
			}
			job.index += 1;
			job.retried = false;
			if (job.index >= job.batches.length) {
				job.phase = "argument";
				send(job, argumentMessage(job.output, job.withRepo));
				return;
			}
		} else if (job.phase === "argument") {
			job.phase = "check";
			send(job, checkMessage(job.output));
			return;
		} else if (job.phase === "check") {
			const findings = await readJson(resolve(dir, "init-findings.json"));
			const list = errorLines(findings);
			const errors = Array.isArray(findings) ? list.length : 1;
			if (errors && job.checkRounds < 2) {
				job.checkRounds += 1;
				send(job, checkMessage(job.output, list));
				return;
			}
			job.phase = "done";
			job.note = errors ? "检查仍有错误，见意见和初始化报告" : "";
			await saveJob(job);
			return;
		} else return;
		job.before = copyState(await readJson(resolve(dir, "project.json")) ?? {});
		send(job, copyMessage(job.output, job.batches[job.index], job.index + 1, job.batches.length, job.before, false));
	}
	ctx.on("agent/turn-stopping", ({ agent }) => {
		const job = jobs.get(SessionId(agent.id));
		if (job) job.completed = true;
	});
	ctx.on("agent/inbox/inserted", ({ agent, message }) => {
		const job = jobs.get(SessionId(agent.id));
		if (job && job.phase !== "done" && message.source?.kind === "user" && message.id !== job.sent && !job.paused) job.paused = "你在对话里发了新消息，初始化已暂停";
	});
	ctx.on("agent/status", ({ agent, status }) => {
		const job = jobs.get(SessionId(agent.id));
		if (!job || status !== "idle" || job.paused || job.phase === "done") return;
		if (!job.completed) {
			job.paused = "这一轮被中止，初始化已暂停";
			return;
		}
		advance(job).catch((error) => {
			job.paused = `初始化出错：${error instanceof Error ? error.message : String(error)}`;
		});
	});
	/** Resolve a workspace-relative project directory inside the workspace and return its store. */
	const storeAt = async (sessionId, path) => {
		const root = await realpath(await rootFor(sessionId));
		const rel = path ?? current.get(sessionId);
		if (!rel) throw new Error("No project selected: pass the workspace-relative project directory (the folder holding project.json)");
		const dir = resolve(root, rel);
		if (relative(root, dir).startsWith("..")) throw new Error("The project must be inside the conversation workspace");
		await stat(resolve(dir, "project.json")).catch(() => {
			throw new Error(`No project.json in ${JSON.stringify(rel)}`);
		});
		let store = stores.get(dir);
		if (!store) {
			store = new ProjectStore(dir);
			stores.set(dir, store);
		}
		return {
			store,
			path: relative(root, dir) || "."
		};
	};
	const agentOf = (exec) => {
		if (!exec.agent) throw new Error("A conversation is required");
		return exec.agent.id;
	};
	const output = {
		schema: { type: "json" },
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value)
		}]
	};
	const projectParam = {
		type: "string",
		description: "Workspace-relative project directory (holding project.json); omit for the project open in the panel."
	};
	const actor = (exec) => `agent（对话 ${String(exec.agent?.id ?? "").replace(/^session-/, "").slice(0, 8)}）`;
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "project_read",
		description: "Read a paper project: thesis, beats and claims always; add figures, sections, comments, numbers, sync or materials with include. ids narrows claims and paragraphs (a claim id also selects the paragraphs stating it). numberMatches (projects initialised with a repository) lists the manuscript numbers with the repository files that contain them, to confirm as sources.",
		parameters: {
			project: projectParam,
			include: {
				type: "array",
				items: { type: "string" },
				description: "Any of figures, sections, comments, numbers, sync, materials, numberMatches."
			},
			ids: {
				type: "array",
				items: { type: "string" },
				description: "Claim or paragraph ids to keep."
			}
		},
		output,
		async execute(args, exec) {
			const { store } = await storeAt(agentOf(exec), args.project);
			return readTool(store, args);
		},
		presentCall: () => ({
			card: "generic",
			kind: "read",
			title: "Read project"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "project_apply",
		description: "Apply changes to the project (claims, evidence, beats, figures, numbers, sections). They are written at once, recorded with your reason and shown to the author as changed since review. Answer the comments you handled in responses. Do not use it to rewrite existing paragraphs: use project_draft. Exception: while initialising a project (paper-project-init) you write the sections and paragraphs you copy from the manuscript with upsert-section/upsert-paragraph, and may correct your own copy (same id).\nShapes: {op:\"set-thesis\",thesis:{title,statement}} | {op:\"upsert-beat\",beat:{id,title,summary,claims:[ids]}} | {op:\"upsert-claim\",claim:{id,title,statement,role:\"core\"|\"support\",reviewerQuestion,evidence:[{id,kind:\"how\"|\"support\"|\"limit\"|\"gap\",status:\"sufficient\"|\"partial\"|\"missing\"|\"risk\",text,source,panels:[{figure,label}],owner,due}]}} | {op:\"upsert-figure\",figure:{id,label,title,caption,placement:\"main\"|\"extended\"|\"unplaced\",panels:[{label,note}]}} | {op:\"upsert-number\",number:{id,label,value,source}} | {op:\"upsert-section\",section:{id,heading,beat,paragraphs:[]}} | {op:\"upsert-paragraph\",section,paragraph:{id,text,claims:[ids]}} | {op:\"remove\",unit,id} | {op:\"ignore-number\",value,where}. Rules: upserts replace the whole unit; each evidence item is one thing (the method is a \"how\" item, each result a \"support\" item, each caveat a \"limit\" item, each missing analysis a \"gap\" item); a registered number holds exactly one value as the text writes it (e.g. \"0.794\", \"4,321\", \"71%\") with its source; mark a claim \"core\" when the thesis fails without it.",
		parameters: {
			project: projectParam,
			changes: {
				type: "array",
				required: true,
				items: { type: "json" },
				description: "Change objects: set-thesis, upsert-beat, upsert-claim (whole claim), upsert-figure, upsert-number, upsert-section, upsert-paragraph (new paragraphs), remove, ignore-number."
			},
			reason: {
				type: "string",
				required: true,
				description: "One sentence: why."
			},
			responses: {
				type: "array",
				items: { type: "json" },
				description: "[{comment, text}] — what this call changed for each comment."
			}
		},
		output,
		async execute(args, exec) {
			const { store } = await storeAt(agentOf(exec), args.project);
			return applyTool(store, args, actor(exec));
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Update project"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "project_comment",
		description: "Record comments on the project: review comments in the role you were asked to take (editor, reviewer or audience), or with source \"check\" a problem found while checking the project against its manuscript and repository - state the problem, then what the author should do.",
		parameters: {
			project: projectParam,
			comments: {
				type: "array",
				required: true,
				items: { type: "json" },
				description: "[{source: editor|reviewer|audience|check, target: {kind, id, quote}, text}]"
			}
		},
		output,
		async execute(args, exec) {
			const { store } = await storeAt(agentOf(exec), args.project);
			return commentTool(store, args);
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Record review comments"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "project_draft",
		description: "Propose rewrites of existing paragraphs. Nothing is replaced: the author sees each word diff and accepts or discards it.",
		parameters: {
			project: projectParam,
			drafts: {
				type: "array",
				required: true,
				items: { type: "json" },
				description: "[{paragraph, text, reason, comments?}]"
			}
		},
		output,
		async execute(args, exec) {
			const { store } = await storeAt(agentOf(exec), args.project);
			return draftTool(store, args, actor(exec));
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Propose paragraph rewrites"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "project_link_paragraphs",
		description: "Record which claims each existing paragraph states, without changing its text (used after initialising a project from a manuscript). Map every paragraph id to the claim ids it states; use [] for paragraphs that state none (methods detail, acknowledgements, references).",
		parameters: {
			project: projectParam,
			links: {
				type: "json",
				required: true,
				description: "{\"<paragraph id>\": [\"<claim id>\", ...], ...}"
			},
			reason: {
				type: "string",
				description: "One sentence."
			}
		},
		output,
		async execute(args, exec) {
			const { store } = await storeAt(agentOf(exec), args.project);
			return linkTool(store, args, actor(exec));
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Link paragraphs to claims"
		})
	})));
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "project_number_hints",
		description: "Record your sort of unregistered numbers: key \"<where>|<value>\" from project_read numbers, kind result|parameter|citation|other, short note.",
		parameters: {
			project: projectParam,
			hints: {
				type: "array",
				required: true,
				items: { type: "json" },
				description: "[{key, kind, note}]"
			}
		},
		output,
		async execute(args, exec) {
			const { store } = await storeAt(agentOf(exec), args.project);
			return numberHintsTool(store, args);
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Sort numbers"
		})
	})));
	const methods = [
		"paper-project/open",
		"paper-project/view",
		"paper-project/revision",
		"paper-project/apply",
		"paper-project/comment",
		"paper-project/set-comment",
		"paper-project/confirm",
		"paper-project/stage",
		"paper-project/in-sync",
		"paper-project/draft",
		"paper-project/claim-at",
		"paper-project/assign",
		"paper-project/ask",
		"paper-project/asset"
	];
	const envelope = z.object({
		type: z.literal("client-request"),
		rpcId: z.string(),
		method: z.enum(methods),
		payload: z.unknown()
	});
	for (const method of [
		"paper-project/init",
		"paper-project/check-init",
		"paper-project/browse",
		"paper-project/init-status",
		"paper-project/init-control"
	]) ctx.effect(() => ctx.connection.fetch.register({
		path: `/api/${method}`,
		methods: ["POST"],
		requestBody: "buffered",
		async fetch(request) {
			const parsed = z.object({
				type: z.literal("client-request"),
				rpcId: z.string(),
				method: z.literal(method),
				payload: z.unknown()
			}).safeParse(await request.json().catch(() => void 0));
			if (!parsed.success) return new Response("Invalid project request", { status: 400 });
			let result;
			try {
				const sessionId = SessionId(z.object({ sessionId: z.string().min(1) }).parse(parsed.data.payload).sessionId);
				const root = await realpath(await rootFor(sessionId));
				if (method === "paper-project/browse") result = {
					ok: true,
					value: {
						workspace: root,
						...await browse(root, z.object({ path: z.string().max(1e3).default("") }).parse(parsed.data.payload).path)
					}
				};
				else if (method === "paper-project/init-status") {
					const { project } = z.object({ project: z.string().max(300).default("") }).parse(parsed.data.payload);
					const job = jobs.get(sessionId) ?? (project ? await loadJob(sessionId, root, project) : null);
					result = {
						ok: true,
						value: job ? {
							output: job.output,
							phase: job.phase,
							paused: job.paused,
							note: job.note,
							round: job.phase === "copy" ? job.index + 1 : 0,
							rounds: job.batches.length,
							label: job.phase === "copy" ? job.batches[job.index]?.label ?? "" : ""
						} : null
					};
				} else if (method === "paper-project/init-control") {
					const { action } = z.object({ action: z.enum([
						"pause",
						"resume",
						"stop"
					]) }).parse(parsed.data.payload);
					const { project } = z.object({ project: z.string().max(300).default("") }).parse(parsed.data.payload);
					let job = jobs.get(sessionId);
					if (!job && project) {
						const loaded = await loadJob(sessionId, root, project);
						if (loaded) {
							job = loaded;
							jobs.set(sessionId, loaded);
						}
					}
					if (!job) throw new Error("No initialisation is running in this conversation");
					if (action === "stop") {
						jobs.delete(sessionId);
						job.phase = "done";
						job.note = "已停止";
						await saveJob(job);
					} else if (action === "pause") job.paused = "已暂停";
					else {
						if (ctx.agents.get(sessionId)?.status === "running") throw new Error("Wait for the current response to finish, then resume");
						job.paused = "";
						if (job.phase === "copy" && job.batches[job.index]) {
							job.before = copyState(await readJson(resolve(root, job.output, "project.json")) ?? {});
							send(job, copyMessage(job.output, job.batches[job.index], job.index + 1, job.batches.length, job.before, false));
						} else if (job.phase === "check") send(job, checkMessage(job.output, errorLines(await readJson(resolve(root, job.output, "init-findings.json")))));
						else send(job, job.lastText);
					}
					result = {
						ok: true,
						value: null
					};
				} else if (method === "paper-project/check-init") result = {
					ok: true,
					value: {
						workspace: root,
						problems: await checkInit(root, InitFormSchema.parse(parsed.data.payload))
					}
				};
				else {
					const input = InitFormSchema.extend({
						source: z.string().min(1).max(1e3),
						output: z.string().min(1).max(300),
						requestId: z.string().uuid()
					}).parse(parsed.data.payload);
					const errors = (await checkInit(root, input)).filter((p) => p.level === "error");
					if (errors.length) throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join("; "));
					if (launches.get(sessionId) === input.requestId) result = {
						ok: true,
						value: null
					};
					else {
						const agent = ctx.agents.get(sessionId);
						if (!agent || agent.status === "running") throw new Error("Wait for the current response to finish, then try again");
						launches.set(sessionId, input.requestId);
						const prompt = prepareMessage([
							`Workspace: ${JSON.stringify(root)}`,
							`Manuscript: ${JSON.stringify(input.source)}`,
							...input.figures ? [`Figures: ${JSON.stringify(input.figures)}`] : [],
							...input.notes ? [`Existing comments: ${JSON.stringify(input.notes)}`] : [],
							...input.repo ? [`Research repository (read only; use --repo): ${JSON.stringify(input.repo)}`] : [],
							`New project directory: ${JSON.stringify(input.output)}`,
							"The original files are only read."
						]);
						const nativeSkill = ctx.get("skills") && ctx.tools.schemas(agent).some((tool) => tool.name === "skill");
						const skillPath = fileURLToPath(new URL("../skills/paper-project-init/", import.meta.url));
						const skill = (await readFile(new URL("../skills/paper-project-init/SKILL.md", import.meta.url), "utf8")).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
						const text = nativeSkill ? `/paper-project-init\n${prompt}` : `${prompt}\n\n<skill_content name="paper-project-init">\nBase directory for this skill: ${skillPath}\n\n${skill}\n</skill_content>`;
						const job = {
							sessionId,
							root,
							output: relative(root, resolve(root, input.output)),
							withRepo: Boolean(input.repo),
							phase: "prepare",
							batches: [],
							index: 0,
							retried: false,
							checkRounds: 0,
							before: null,
							sent: "",
							lastText: "",
							completed: false,
							paused: "",
							note: ""
						};
						jobs.set(sessionId, job);
						send(job, text);
						current.set(sessionId, relative(root, resolve(root, input.output)));
						result = {
							ok: true,
							value: null
						};
					}
				}
			} catch (error) {
				result = {
					ok: false,
					error: {
						code: "paper-project/refused",
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
	for (const method of methods) ctx.effect(() => ctx.connection.fetch.register({
		path: `/api/${method}`,
		methods: ["POST"],
		requestBody: "buffered",
		async fetch(request) {
			if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") return new Response("Expected application/json", { status: 415 });
			const parsed = envelope.safeParse(await request.json().catch(() => void 0));
			if (!parsed.success || parsed.data.method !== method) return new Response("Invalid project request", { status: 400 });
			let result;
			try {
				request.signal.throwIfAborted();
				const base = z.object({
					sessionId: z.string().min(1),
					project: z.string().min(1)
				}).parse(parsed.data.payload);
				const sessionId = SessionId(base.sessionId);
				const { store, path } = await storeAt(sessionId, base.project);
				const body = parsed.data.payload;
				const author = "作者";
				let value;
				switch (method) {
					case "paper-project/open":
						current.set(sessionId, path);
						value = await store.view();
						break;
					case "paper-project/view":
						value = await store.view();
						break;
					case "paper-project/revision":
						value = await store.revision(z.number().int().min(0).parse(body.n));
						break;
					case "paper-project/apply":
						value = await store.apply({
							changes: z.array(ChangeSchema).parse(body.changes),
							actor: author,
							reason: z.string().min(1).parse(body.reason)
						});
						break;
					case "paper-project/comment":
						value = (await store.addComment({
							target: TargetSchema.parse(body.target),
							source: "author",
							author,
							text: z.string().min(1).parse(body.text)
						})).view;
						break;
					case "paper-project/set-comment":
						value = await store.setComment(z.string().parse(body.id), CommentSchema.shape.status.parse(body.status));
						break;
					case "paper-project/confirm":
						value = await store.confirm(z.array(z.string()).parse(body.keys));
						break;
					case "paper-project/stage":
						value = await store.setStage(StageSchema.parse(body.stage), author, z.string().default("").parse(body.reason));
						break;
					case "paper-project/in-sync":
						value = await store.markInSync(z.string().parse(body.paragraph), author);
						break;
					case "paper-project/draft":
						value = await store.decideDraft(z.string().parse(body.id), body.accept === true, author, typeof body.text === "string" ? body.text : void 0);
						break;
					case "paper-project/claim-at":
						value = { claim: await store.claimAt(z.string().parse(body.claim), z.string().parse(body.hash)) };
						break;
					case "paper-project/assign":
						value = await store.setAssignee(z.string().parse(body.id), z.string().default("").parse(body.assignee));
						break;
					case "paper-project/asset": {
						const file = resolve(store.root, z.string().parse(body.path));
						if (relative(store.root, file).startsWith("..")) throw new Error("The image must be inside the project");
						const type = IMAGE_TYPES[extname(file).toLowerCase()];
						if (!type) throw new Error("Unsupported image type");
						if ((await stat(file)).size > MAX_ASSET_BYTES) throw new Error("Image too large");
						value = { url: `data:${type};base64,${(await readFile(file)).toString("base64")}` };
						break;
					}
					case "paper-project/ask": {
						const input = z.object({
							task: TaskSchema,
							requestId: z.string().uuid()
						}).parse(body);
						if (launches.get(sessionId) === input.requestId) {
							value = { summary: "已提交" };
							break;
						}
						const agent = ctx.agents.get(sessionId);
						if (!agent || agent.status === "running") throw new Error("Wait for the current response to finish, then ask again");
						launches.set(sessionId, input.requestId);
						current.set(sessionId, path);
						const { project } = await store.load();
						agent.followup(createUserMessage({
							source: { kind: "user" },
							content: [{
								type: "text",
								text: agentTaskMessage(input.task, path, project.style)
							}]
						}));
						value = { summary: "已交给当前对话中的 agent；完成后面板会自动刷新" };
						break;
					}
				}
				result = {
					ok: true,
					value
				};
			} catch (error) {
				result = {
					ok: false,
					error: {
						code: "paper-project/refused",
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
//#region src/index.ts
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
	maxFigureBytes: ConfigSchema.natural().min(1).default(67108864),
	previewCacheBytes: ConfigSchema.natural().default(4194304),
	previewConcurrency: ConfigSchema.natural().min(1).max(8).default(1)
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
	"paper_figure_replace",
	"paper_panel_set"
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
	const updater = new SelfUpdate(ctx.get("profileContext"));
	ctx.effect(() => ctx.connection.fetch.register({
		path: "/api/paper-review/update",
		methods: ["POST"],
		requestBody: "buffered",
		async fetch(request) {
			if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") return new Response("Expected application/json", { status: 415 });
			const parsed = z.object({
				type: z.literal("client-request"),
				rpcId: z.string(),
				method: z.literal("paper-review/update"),
				payload: z.object({ enabled: z.boolean().optional() }).strict()
			}).safeParse(await request.json().catch(() => void 0));
			if (!parsed.success) return new Response("Invalid update request", { status: 400 });
			try {
				const value = parsed.data.payload.enabled === void 0 ? await updater.view() : await updater.setEnabled(parsed.data.payload.enabled);
				return Response.json({
					type: "server-response",
					rpcId: parsed.data.rpcId,
					result: {
						ok: true,
						value
					}
				}, { headers: { "Cache-Control": "no-store" } });
			} catch (error) {
				return Response.json({
					type: "server-response",
					rpcId: parsed.data.rpcId,
					result: {
						ok: false,
						error: { message: error instanceof Error ? error.message : "Update settings failed" }
					}
				});
			}
		}
	}));
	ctx.inject(["skills"], async (scope) => {
		for (const [name, description] of [
			["paper-figure-panels", "Split figure panels and place verified crops beside their exact manuscript paragraphs in Paper review."],
			["paper-project-start", "Import PDF, DOCX, LaTeX, TXT, Markdown, HTML or pasted article content, prepare available figures, and open Paper review."],
			["paper-project-init", "Turn an existing manuscript, its figures and comments into a new paper project (story flow, claims, figures, numbers, linked paragraphs) without changing the originals."]
		]) {
			const path = fileURLToPath(new URL(`../skills/${name}/`, import.meta.url));
			const content = await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
			scope.effect(() => scope.skills.register({
				name,
				description,
				source: "dsh-article-review",
				path,
				resourceBase: {
					kind: "directory",
					path
				},
				content: content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
			}));
		}
	});
	const previews = new PdfPreviewCache(config.previewCacheBytes, config.previewConcurrency);
	ctx.effect(() => () => {
		previews.dispose();
	});
	const stores = /* @__PURE__ */ new Map();
	const enabled = /* @__PURE__ */ new Set();
	const scopes = /* @__PURE__ */ new Map();
	const panelTargets = /* @__PURE__ */ new Map();
	const readerOpenRequests = /* @__PURE__ */ new Map();
	ctx.on("agent/status", ({ agent, status }) => {
		if (status === "idle") panelTargets.delete(agent.id);
	});
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
	const assertPanelDestination = async (agent, path) => {
		const target = panelTargets.get(agent.id);
		if (!target) return;
		const root = await realpath(await rootFor(agent.id));
		if (root !== target.workspaceRoot || resolve(root, path) !== resolve(root, target.path)) throw new Error(`Panel preparation is targeting ${JSON.stringify(target.path)} in ${JSON.stringify(target.workspaceRoot)}; keep this destination instead of a copy`);
	};
	ctx.effect(() => async () => {
		for (const dispose of scopes.values()) dispose();
		scopes.clear();
		await Promise.all([...stores.values()].map(async (pending) => {
			await (await pending).close();
		}));
	});
	applyProject(ctx, rootFor);
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
			await assertPanelDestination(exec.agent, args.path);
			const store = await storeFor(exec.agent.id);
			const { document, diskChanged } = await store.read(args.path);
			await enable(exec.agent.id, store, true);
			await store.selectPath(exec.agent.id, document.path);
			readerOpenRequests.set(exec.agent.id, {
				requestId: randomUUID(),
				path: document.path
			});
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
	const readRequest = z.object({
		path: z.string(),
		blockId: z.string().optional(),
		proposalId: z.string().optional(),
		startBlock: z.number().optional(),
		maxBlocks: z.number().optional(),
		maxCharacters: z.number().optional(),
		revision: z.string().optional(),
		includePanels: z.boolean().optional()
	});
	for (const toolName of [
		"paper_read",
		"paper_annotations",
		"paper_check"
	]) ctx.effect(() => ctx.tools.register(defineTool({
		name: toolName,
		description: toolName === "paper_read" ? "Read manuscript blocks and their exact ids and revision. For long manuscripts, set startBlock=0 and maxBlocks (1–200). Follow page.nextStartBlock using the returned revision; never mix revisions. maxCharacters is a soft budget: an oversized first block is returned whole and explicitly flagged, never truncated. Optionally read one block plus its neighbors; a selected block also returns beforeHash for paper_delete, so LaTeX or table Markdown need not be retyped. Preserve scientific claims; never strengthen causality, generalizability, novelty, significance or superiority without explicit author instruction." : toolName === "paper_annotations" ? "Read author annotations and their exact quotations. Detached annotations require the author to locate them again." : "Revalidate pending proposals using the actual acceptance preflight: exact source, author locks, citation bindings, retained figure hashes and size limits. Returns actionable blockers and source-offset lexical evidence without writing the manuscript. Pass proposalId to read one pending proposal in full before revising it. Mechanical flags are review hints, not scientific verification.",
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
			},
			...toolName === "paper_read" ? {
				startBlock: {
					type: "number",
					description: "Zero-based block index for whole-block pagination; incompatible with blockId."
				},
				maxBlocks: {
					type: "number",
					description: "Maximum whole blocks per page, integer 1–200; default 40."
				},
				maxCharacters: {
					type: "number",
					description: "Soft UTF-16 character budget, 1000–200000; default 32000. The first block remains whole."
				},
				revision: {
					type: "string",
					description: "Required for continuation pages; exact revision returned by the first page."
				},
				includePanels: {
					type: "boolean",
					description: "Default true. Set false for compact paragraph reads that omit full panel maps and repeated before text."
				}
			} : {}
		},
		output,
		async execute(input, exec) {
			exec.signal.throwIfAborted();
			const args = readRequest.parse(input);
			const store = await modelStore(exec.agent);
			if (toolName === "paper_check") {
				const { proposal, ...checked } = await store.check(args.path, args.proposalId);
				return {
					...checked,
					...proposal ? { proposal: modelProposal(proposal) } : {}
				};
			}
			const { document, diskChanged } = await store.read(args.path);
			if (toolName === "paper_annotations") return {
				revision: document.current.id,
				annotations: document.annotations.filter((annotation) => args.blockId === void 0 || annotation.blockId === args.blockId).map(({ id, blockId, revision, quote, prefix, suffix, comment, status, anchor }) => ({
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
			const paged = args.startBlock !== void 0 || args.maxBlocks !== void 0 || args.maxCharacters !== void 0;
			if (paged && args.blockId !== void 0) throw new Error("Use blockId or pagination, not both");
			if (args.revision !== void 0 && args.revision !== document.current.id) throw new Error("Reader revision changed; reread the manuscript");
			const page = paged ? readManuscriptPage(document.current, {
				startBlock: args.startBlock,
				maxBlocks: args.maxBlocks,
				maxCharacters: args.maxCharacters,
				revision: args.revision
			}) : void 0;
			const index = args.blockId === void 0 ? -1 : document.current.blocks.findIndex((b) => b.id === args.blockId);
			if (args.blockId !== void 0 && index === -1) throw new Error("Block no longer exists; reread the manuscript");
			const selectedBlock = document.current.blocks[index];
			return {
				path: document.path,
				revision: document.current.id,
				diskChanged,
				...args.includePanels !== false && document.figurePanels ? { figurePanels: document.figurePanels.map(({ stale, ...panel }) => stale === void 0 ? panel : {
					...panel,
					stale
				}) } : {},
				blocks: page?.blocks ?? (index === -1 ? document.current.blocks : document.current.blocks.slice(Math.max(0, index - 1), index + 2)),
				...page ? { page: page.page } : {},
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
		description: "List the exact local figures referenced by the current manuscript, with block ids, authored paths, workspace files and source hashes. Optionally export a workspace JSON packet of these figures and current manuscript blocks for panel helpers; existing different files are never overwritten. Missing figures are not guessed.",
		parameters: {
			path: pathParameter,
			packet: {
				type: "string",
				description: "Optional new workspace-relative .json context snapshot for panel helpers, outside .paper-review. Same content may be reused."
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			return (await modelStore(exec.agent)).listFigures(args.path, args.packet);
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
		name: "paper_panel_set",
		description: "Save verified PNG panel crops beside exact manuscript paragraphs. Use either manifest (a workspace JSON file of complete prepared arguments) or all inline fields. Replaces one figure map; an empty panels array removes it. Both forms validate the current revision, sourceHash, crops and exact paragraph text. Returns a compact confirmation; use paper_read for full metadata. Never edits artwork or manuscript prose.",
		parameters: {
			path: pathParameter,
			manifest: {
				type: "string",
				description: "Workspace-relative .json file containing revision, figureBlockId, figure, sourceHash and panels; an optional path must match this manuscript. Omit inline fields when using it."
			},
			revision: { type: "string" },
			figureBlockId: { type: "string" },
			figure: { type: "string" },
			sourceHash: { type: "string" },
			panels: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						label: {
							type: "string",
							required: true
						},
						file: {
							type: "string",
							required: true
						},
						page: {
							type: "integer",
							required: true
						},
						region: {
							type: "array",
							required: true,
							items: { type: "number" }
						},
						targets: {
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
									}
								}
							}
						}
					}
				}
			}
		},
		output,
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			if (args.manifest !== void 0 && [
				args.revision,
				args.figureBlockId,
				args.figure,
				args.sourceHash,
				args.panels
			].some((value) => value !== void 0)) throw new Error("Supply a panel manifest or inline panel fields, not both");
			if (!exec.agent) throw new Error("A conversation is required");
			await assertPanelDestination(exec.agent, args.path);
			const store = await modelStore(exec.agent);
			const input = args.manifest === void 0 ? PanelInputSchema.parse(args) : await store.readPanelManifest(args.path, args.manifest);
			const result = await store.setPanels(args.path, input);
			return {
				workspaceRoot: await realpath(await rootFor(exec.agent.id)),
				path: result.document.path,
				revision: result.document.current.id,
				...panelAcknowledgement(result.document.figurePanels ?? [], input)
			};
		},
		presentCall: () => ({
			card: "generic",
			kind: "other",
			title: "Arrange figure panels for reading"
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
				description: "Attached author annotation ids. Omit when proposing a change without annotations."
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
			const proposal = (await (await modelStore(exec.agent)).propose(args.path, ProposalInputSchema.parse({
				...args,
				annotationIds: args.annotationIds ?? []
			}))).document.proposals.at(-1);
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
			const tools = agent.ctx.tools;
			if (enabled.has(agent.id) && "presentAs" in tools && typeof tools.presentAs === "function") disposers.push(tools.presentAs("native"));
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
	const panelLaunches = /* @__PURE__ */ new Map();
	const importLaunches = /* @__PURE__ */ new Map();
	const importing = /* @__PURE__ */ new Set();
	const methods = [
		"paper-review/start-project",
		"paper-review/open-request",
		"paper-review/prepare-panels",
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
		"paper-review/replace-figure",
		"paper-review/revision"
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
				const payload = z.object({
					sessionId: z.string().min(1),
					projection: z.literal("workbench").optional()
				}).parse(parsed.data.payload);
				const sessionId = SessionId(payload.sessionId);
				if (parsed.data.method === "paper-review/open-request") {
					await rootFor(sessionId);
					return Response.json({
						type: "server-response",
						rpcId: parsed.data.rpcId,
						result: {
							ok: true,
							value: readerOpenRequests.get(sessionId) ?? null
						}
					});
				}
				const store = await storeFor(sessionId);
				if (parsed.data.method === "paper-review/start-project") {
					const input = ArticleInputSchema.and(z.object({ requestId: z.string().uuid() })).parse(parsed.data.payload);
					if (importLaunches.get(sessionId) === input.requestId) result = {
						ok: true,
						value: null
					};
					else {
						const agent = ctx.agents.get(sessionId);
						if (!agent || agent.status === "running") throw new Error("Wait for the current response to finish before importing an article");
						if (importing.has(sessionId)) throw new Error("An article import is already being submitted");
						importLaunches.set(sessionId, input.requestId);
						importing.add(sessionId);
						try {
							const workspaceRoot = await realpath(await rootFor(sessionId));
							const cwd = agent.session.header.cwd;
							if (!cwd || await realpath(cwd) !== workspaceRoot) throw new Error(`Select ${JSON.stringify(workspaceRoot)} as this conversation's workspace before importing; the model must be able to write the destination`);
							const source = await prepareArticleInput(workspaceRoot, input);
							const skillPath = fileURLToPath(new URL("../skills/paper-project-start/", import.meta.url));
							const skill = (await readFile(new URL("../skills/paper-project-start/SKILL.md", import.meta.url), "utf8")).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
							request.signal.throwIfAborted();
							if (ctx.agents.get(sessionId) !== agent || ctx.agents.get(sessionId)?.status === "running") throw new Error("The conversation changed; wait for its response and retry");
							const prompt = `Start an article review using the paper-project-start skill.\n\nWorkspace: ${JSON.stringify(workspaceRoot)}\nInput article: ${JSON.stringify(source)}\n\nRun the bundled normalizer directly, then immediately call paper_open on its returned manuscript. Verify with paper_read(maxBlocks:6, includePanels:false) and paper_figure_list. If there are zero figures, finish immediately with the imported path and conversion warnings. This is an import operation: do not audit the whole paper, inspect unrelated directories, validate references, dump provenance, rewrite prose or start a review checklist. Only when artwork exists, continue with paper-figure-panels. Preserve the exact source and scientific content, other manuscripts, conversations, drafts and running tasks.`;
							const text = ctx.get("skills") && ctx.tools.schemas(agent).some((tool) => tool.name === "skill") ? `/paper-project-start\n${prompt}` : `${prompt}\n\n<skill_content name="paper-project-start">\nBase directory for this skill: ${skillPath}\n\n${skill}\n</skill_content>`;
							agent.followup(createUserMessage({
								source: { kind: "user" },
								content: [{
									type: "text",
									text
								}]
							}));
						} catch (error) {
							importLaunches.delete(sessionId);
							throw error;
						} finally {
							importing.delete(sessionId);
						}
						result = {
							ok: true,
							value: null
						};
					}
				} else if (parsed.data.method === "paper-review/prepare-panels") {
					const input = z.object({
						path: z.string(),
						revision: z.string(),
						intent: z.string().min(1).max(4e3),
						requestId: z.string().uuid()
					}).parse(parsed.data.payload);
					if (!enabled.has(sessionId)) throw new Error("Open a manuscript before arranging panels");
					if (panelLaunches.get(sessionId) === input.requestId) result = {
						ok: true,
						value: null
					};
					else {
						const agent = ctx.agents.get(sessionId);
						if (!agent || agent.status === "running") throw new Error("Wait for the current response to finish before arranging panels");
						const { document, diskChanged } = await store.read(input.path);
						if (document.current.id !== input.revision || diskChanged || await store.selectedPath(sessionId) !== document.path) throw new Error("Load the current manuscript before arranging panels");
						const skillPath = fileURLToPath(new URL("../skills/paper-figure-panels/", import.meta.url));
						const skill = (await readFile(new URL("../skills/paper-figure-panels/SKILL.md", import.meta.url), "utf8")).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
						request.signal.throwIfAborted();
						if (ctx.agents.get(sessionId) !== agent || ctx.agents.get(sessionId)?.status === "running") throw new Error("The conversation changed; wait for its response and retry");
						panelLaunches.set(sessionId, input.requestId);
						try {
							const nativeSkill = ctx.get("skills") && ctx.tools.schemas(agent).some((tool) => tool.name === "skill");
							const workspaceRoot = await realpath(await rootFor(sessionId));
							panelTargets.set(sessionId, {
								workspaceRoot,
								path: document.path
							});
							const prompt = `${input.intent}\n\nWorkspace: ${JSON.stringify(workspaceRoot)}\nManuscript: ${JSON.stringify(document.path)}\nReader revision: ${document.current.id}\n\nSave panels to this exact manuscript in this workspace. Do not substitute a scratch copy. Before reporting completion, call paper_figure_list for this path and verify the returned workspaceRoot, path, revision and validPanelCount.`;
							const text = nativeSkill ? `/paper-figure-panels\n${prompt}` : `${prompt}\n\n<skill_content name="paper-figure-panels">\nBase directory for this skill: ${skillPath}\n\n${skill}\n</skill_content>`;
							agent.followup(createUserMessage({
								source: { kind: "user" },
								content: [{
									type: "text",
									text
								}]
							}));
						} catch (error) {
							panelLaunches.delete(sessionId);
							panelTargets.delete(sessionId);
							throw error;
						}
						result = {
							ok: true,
							value: null
						};
					}
				} else if (parsed.data.method === "paper-review/revision") {
					if (!enabled.has(sessionId)) throw new Error("Open a manuscript before comparing versions");
					const input = z.object({
						path: z.string().min(1),
						revision: z.string().min(1).max(160)
					}).parse(parsed.data.payload);
					const { document } = await store.read(input.path);
					const revision = document.revisions.find((version) => version.id === input.revision) ?? (document.current.id === input.revision ? document.current : void 0);
					if (!revision) throw new Error("Manuscript version not found");
					result = {
						ok: true,
						value: revision
					};
				} else if (parsed.data.method === "paper-review/list-files") {
					const listing = z.object({
						path: z.string(),
						extension: z.enum([
							"md",
							"bib",
							"figure",
							"preview"
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
					const view = await store.replaceFigure(input.path, input);
					result = {
						ok: true,
						value: payload.projection === "workbench" ? workbenchView(view) : view
					};
				} else if (parsed.data.method === "paper-review/pick-figure") {
					const root = await realpath(await rootFor(sessionId));
					const selected = z.object({ selectedPath: z.string().min(1).optional() }).parse(parsed.data.payload).selectedPath ?? await pickNativeFigure(root, request.signal);
					if (selected === null) result = {
						ok: true,
						value: { path: null }
					};
					else {
						const path = await selectedWorkspaceFile(root, selected, "figure");
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
					const selected = z.object({ selectedPath: z.string().min(1).optional() }).parse(parsed.data.payload).selectedPath ?? await pickNativeBibliography(root, request.signal);
					if (selected === null) result = {
						ok: true,
						value: { path: null }
					};
					else result = {
						ok: true,
						value: { path: await selectedWorkspaceFile(root, selected, "bib") }
					};
				} else if (parsed.data.method === "paper-review/pick-file") {
					const root = await realpath(await rootFor(sessionId));
					const selected = z.object({ selectedPath: z.string().min(1).optional() }).parse(parsed.data.payload).selectedPath ?? await pickNativeManuscript(root, request.signal);
					if (selected === null) result = {
						ok: true,
						value: { path: null }
					};
					else {
						const path = await selectedWorkspaceFile(root, selected, "md");
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
						value: { url: await previews.get(source, request.signal, size) }
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
						value: payload.projection === "workbench" ? workbenchView(view) : view
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
export { Config, PAPER_DISCOVERY_TOOLS, PAPER_TOOLS, PROJECT_TOOLS, apply, inject, name };
