#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import {
	basicAuthHeader,
	getBuildInfo,
	getChoicesFromConfigXml,
	loadConfigFromFile,
	pickServer,
	readProgressiveText,
	sleep,
	triggerBuild,
	tryGetCrumb,
	waitForExecutable
} from "../lib/jenkins.mjs";
import {
	cmpSemver,
	fuzzyFindChoices,
	fuzzyFindNodeVersionByMajor,
	getDefaultJobForServer,
	loadJenDefaults,
	paramKey,
	parseParams,
	parseSemverFromCandidate,
	shouldApplyPresetDefaults,
	shouldRequireProject,
	uniqueNonEmpty
} from "../lib/presetParams.mjs";
import { resolveJenkinsConfigPath } from "../lib/fpmPaths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function printHelp(exitCode = 0) {
	const help = `
jen-cli

用法:
  jen-cli run [--job <jobName>] [--server <alias>] [--params "k=v,a=b"] [--param k=v ...]
  jen-cli list --key <paramName> [--job <jobName>] [--server <alias>]

参数:
  --config <path>     配置文件路径 (默认: FPM 设置目录 / 仓库 jenkins.config.json)
  --server <alias>    Jenkins 服务器别名 (默认: tx，可选项： tx/txProd/jen/whalePlus/devJenkins)
  --job <name>        Jenkins Job 名称，可含 folder，例如 "folderA/my-job" (默认: server=tx 时为 system3_Front_docker3，server=txProd 时为 pro_system3_Front_docker3)
  --params <csv>      逗号分隔参数，例如 "branch=uat5,NodeVersion=24.12.0"
  --param <kv>        单个参数 k=v，可重复多次
  --key <name>        list 命令要查看的参数名（任意 Job 参数名；静态选项来自 config.xml，动态选项走插件 fillValueItems）
  --no-console        不打印控制台增量日志，只打印状态
  --interval <ms>     轮询间隔毫秒 (默认: 3000)

快捷命令:
  list / ls / l       通用查看任意参数候选列表（含 Git Parameter 等插件动态列表）
  lp                  等价于: list --key project
  ln                  等价于: list --key NodeVersion

参数规则:
  当 server=tx 且 job=system3_Front_docker1/2/3/4 时，默认补齐:
    branch=uat5
    NodeVersion=v24.12.0 (也支持简写: 24 / v24 / 10 / v10 等)
    INSTALL_COMMAND_ACTIVE=pnpm i --registry https://repo.huaweicloud.com/repository/npm
    BUILD_COMMAND_ACTIVE=pnpm build:uat (若 branch=master/master4/master5 且未显式指定 BUILD_COMMAND_ACTIVE，则默认 pnpm build:prod)
  当 server=txProd 且 job=pro_system3_Front_docker3 时，默认补齐:
    branch=master5
    NodeVersion=v24.12.0
    INSTALL_COMMAND_ACTIVE=pnpm i --registry https://repo.huaweicloud.com/repository/npm
    BUILD_COMMAND_ACTIVE=pnpm run build:prod
  project 仅在 server=tx 且 job=system3_Front_docker1/2/3/4 时必选（支持模糊匹配，未命中时会要求从列表选择）
  任意参数值若是 npm/pnpm install 指令且未带 --registry，会自动补齐华为源 registry
`;
	// eslint-disable-next-line no-console
	console.log(help.trim());
	process.exit(exitCode);
}

function parseArgs(argv) {
	const defaults = loadJenDefaults();
	const cli = defaults.cliDefaults || {};
	const out = {
		command: null,
		configPath: resolveJenkinsConfigPath(repoRoot),
		server: undefined,
		job: undefined,
		paramsCsv: undefined,
		paramKvs: [],
		listKey: undefined,
		console: cli.console !== false,
		intervalMs: Number(cli.intervalMs) > 0 ? Number(cli.intervalMs) : 3000,
		_serverExplicit: false,
		_jobExplicit: false,
		_consoleExplicit: false,
		_intervalExplicit: false
	};

	const args = argv.slice(2);
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		printHelp(0);
	}

	out.command = args[0];
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--config") out.configPath = path.resolve(process.cwd(), args[++i] ?? "");
		else if (a === "--server") {
			out.server = args[++i];
			out._serverExplicit = true;
		} else if (a === "--job") {
			out.job = args[++i];
			out._jobExplicit = true;
		} else if (a === "--params") out.paramsCsv = args[++i];
		else if (a === "--param") out.paramKvs.push(args[++i]);
		else if (a === "--key" || a === "-k") out.listKey = args[++i];
		else if (a === "--no-console") {
			out.console = false;
			out._consoleExplicit = true;
		} else if (a === "--interval") {
			out.intervalMs = Number(args[++i]);
			out._intervalExplicit = true;
		} else if (a === "--help" || a === "-h") printHelp(0);
		else {
			// eslint-disable-next-line no-console
			console.error(`未知参数: ${a}`);
			printHelp(2);
		}
	}

	if (!out._serverExplicit && cli.server) out.server = String(cli.server);
	if (!out._jobExplicit && cli.job) out.job = String(cli.job);

	const known = new Set(["run", "list", "ls", "l", "lp", "ln"]);
	if (!known.has(out.command)) {
		// eslint-disable-next-line no-console
		console.error(`未知命令: ${out.command}`);
		printHelp(2);
	}
	if ((out.command === "list" || out.command === "ls" || out.command === "l") && !out.listKey) {
		// eslint-disable-next-line no-console
		console.error("list 命令缺少 --key 参数");
		printHelp(2);
	}
	if (!Number.isFinite(out.intervalMs) || out.intervalMs < 500) out.intervalMs = 3000;

	return out;
}

function loadConfig(configPath) {
	const cfg = loadConfigFromFile(configPath);
	return cfg;
}

async function pickChoiceInteractively(rawInput, candidates, label = "参数") {
	const list = uniqueNonEmpty(candidates);
	if (list.length === 0) return null;
	if (list.length === 1) return list[0];

	// 非交互环境（如 CI）下无法输入，默认选择第一个，避免卡住
	if (!process.stdin.isTTY || !process.stdout.isTTY) return list[0];

	// eslint-disable-next-line no-console
	console.log(`${label} "${rawInput}" 匹配到多个候选，请输入序号选择:`);
	for (let i = 0; i < list.length; i++) {
		// eslint-disable-next-line no-console
		console.log(`${i + 1}. ${list[i]}`);
	}
	// eslint-disable-next-line no-console
	console.log("回车默认选择 1");

	const rl = readline.createInterface({input: process.stdin, output: process.stdout});
	try {
		const answer = await new Promise((resolve) => {
			rl.question("请输入序号: ", (v) => resolve(String(v ?? "").trim()));
		});
		if (!answer) return list[0];
		const n = Number(answer);
		if (Number.isInteger(n) && n >= 1 && n <= list.length) return list[n - 1];
		return list[0];
	} finally {
		rl.close();
	}
}

// waitForExecutable / getBuildInfo / readProgressiveText 复用 lib/jenkins.mjs

function formatDuration(ms) {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	const ss = s % 60;
	const mm = m % 60;
	if (h > 0) return `${h}h${String(mm).padStart(2, "0")}m${String(ss).padStart(2, "0")}s`;
	if (m > 0) return `${m}m${String(ss).padStart(2, "0")}s`;
	return `${s}s`;
}

function classifyLogLine(rawLine) {
	const line = String(rawLine ?? "");
	const t = line.trim();
	if (!t) return "empty";
	if (/^\[pipeline\]/i.test(t) || /^\[.*stage.*\]/i.test(t) || /stage\b/i.test(t)) return "stage";
	if (/^(?:\+ |>|# |\$ )/.test(t) || /\b(?:npm|pnpm|yarn|node|docker|git)\b/i.test(t)) return "command";
	if (/\b(?:error|failed|exception|fatal|abort|traceback)\b/i.test(t)) return "error";
	if (/\b(?:warn|warning)\b/i.test(t)) return "warn";
	if (/\b(?:success|succeeded|finished|done|completed)\b/i.test(t)) return "success";
	return "normal";
}

function createPrettyLogPrinter() {
	let pending = "";
	let lastGroup = "";

	function printLine(line) {
		const group = classifyLogLine(line);
		if (group === "empty") {
			process.stdout.write("\n");
			return;
		}

		if (lastGroup && group !== lastGroup) {
			process.stdout.write("\n");
		}

		let prefix = "";
		if (group === "error") prefix = "[ERROR] ";
		else if (group === "warn") prefix = "[WARN] ";
		else if (group === "stage") prefix = "[STAGE] ";
		else if (group === "command") prefix = "[CMD] ";
		else if (group === "success") prefix = "[OK] ";

		process.stdout.write(`${prefix}${line}\n`);
		lastGroup = group;
	}

	return {
		write(chunk) {
			const text = String(chunk ?? "");
			if (!text) return;

			const normalized = text.replace(/\r\n/g, "\n");
			const lines = (pending + normalized).split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) printLine(line);
		},
		flush() {
			if (pending) {
				printLine(pending);
				pending = "";
			}
		}
	};
}

async function monitorBuild(buildUrl, {authHeader, intervalMs, printConsole, onLogChunk}) {
	let lastStatusLine = "";
	let consoleStart = 0;
	const prettyPrinter = printConsole ? createPrettyLogPrinter() : null;

	while (true) {
		const info = await getBuildInfo(buildUrl, authHeader);
		const building = Boolean(info?.building);
		const result = info?.result ?? null;
		const duration = typeof info?.duration === "number" ? info.duration : 0;
		const est = typeof info?.estimatedDuration === "number" ? info.estimatedDuration : 0;

		const statusLine = [
			`#${info?.number ?? "?"}`,
			building ? "BUILDING" : "FINISHED",
			result ? `result=${result}` : "",
			duration ? `duration=${formatDuration(duration)}` : "",
			est && building ? `estimated=${formatDuration(est)}` : ""
		]
		.filter(Boolean)
		.join(" ");

		if (statusLine !== lastStatusLine) {
			// eslint-disable-next-line no-console
			console.log(statusLine);
			lastStatusLine = statusLine;
		}

		// 始终拉取增量日志，供控制台实时打印（及可选回调）
		for (let i = 0; i < 10; i++) {
			const {text, nextStart, more} = await readProgressiveText(buildUrl, authHeader, consoleStart);
			if (text) {
				if (prettyPrinter) prettyPrinter.write(text);
				if (typeof onLogChunk === "function") onLogChunk(text);
			}
			consoleStart = nextStart;
			if (!more) break;
		}

		if (!building) {
			// 结束时再补读一次，防止最后一点日志遗漏
			const {text, nextStart} = await readProgressiveText(buildUrl, authHeader, consoleStart);
			if (text) {
				if (prettyPrinter) prettyPrinter.write(text);
				if (typeof onLogChunk === "function") onLogChunk(text);
			}
			if (prettyPrinter) prettyPrinter.flush();
			consoleStart = nextStart;
			return {result: result ?? "UNKNOWN"};
		}

		await sleep(intervalMs);
	}
}

async function main() {
	const args = parseArgs(process.argv);
	const cfg = loadConfig(args.configPath);
	const server = pickServer(cfg, args.server);
	const job = args.job ?? getDefaultJobForServer(server.alias);
	const authHeader = basicAuthHeader(server.username, server.apiToken);

	if (args.command === "list" || args.command === "ls" || args.command === "l" || args.command === "lp" || args.command === "ln") {
		const key =
			args.command === "lp"
				? paramKey("project")
				: args.command === "ln"
					? paramKey("nodeVersion")
					: String(args.listKey || "");

		let list = [];
		try {
			list = await getChoicesFromConfigXml(server, job, key, {
				onFillWarnings: (errs) => {
					for (const e of errs) {
						// eslint-disable-next-line no-console
						console.error(`列表接口警告: ${e}`);
					}
				}
			});
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error(e?.message || String(e));
			process.exit(2);
		}

		// eslint-disable-next-line no-console
		console.log(`使用服务器: ${server.alias} (${server.baseUrl})`);
		// eslint-disable-next-line no-console
		console.log(`Job: ${job}`);
		// eslint-disable-next-line no-console
		console.log(`${key} 候选列表 (${list.length}):`);
		if (list.length === 0) {
			// eslint-disable-next-line no-console
			console.log(
				`  (未读取到可选项：请确认参数名正确；静态参数需 config中含 script/choices；插件参数需支持 descriptorByName/.../fillValueItems)`
			);
			return;
		}
		for (const item of list) {
			// eslint-disable-next-line no-console
			console.log(`  - ${item}`);
		}
		return;
	}

	const params = parseParams({
		paramsCsv: args.paramsCsv,
		paramKvs: args.paramKvs,
		serverAlias: server.alias,
		jobName: job
	});
	const crumb = await tryGetCrumb(server, authHeader);

	const kNode = paramKey("nodeVersion");
	const kProject = paramKey("project");

	// NodeVersion 仅按主版本号模糊匹配（10 / v10 / v10.17.0 都按 major=10）
	const applyPresetForRun = shouldApplyPresetDefaults(server.alias, job);
	const nodeVersionSupplied =
		params[kNode] != null && String(params[kNode]).trim() !== "";
	if (applyPresetForRun || nodeVersionSupplied) {
		try {
			const nodeChoices = uniqueNonEmpty(await getChoicesFromConfigXml(server, job, kNode));
			if (nodeChoices.length === 0) {
				throw new Error(`未读取到 ${kNode} 候选列表`);
			}
			const allNodeChoices = nodeChoices.sort((a, b) => {
				const sa = parseSemverFromCandidate(a);
				const sb = parseSemverFromCandidate(b);
				if (sa && sb) return cmpSemver(sb, sa);
				return String(a).localeCompare(String(b), "zh-CN");
			});
			const nodeCandidates = fuzzyFindNodeVersionByMajor(params[kNode], allNodeChoices);
			let nodePicked = null;
			if (nodeCandidates.length > 0) {
				nodePicked = await pickChoiceInteractively(params[kNode], nodeCandidates, kNode);
			} else {
				// eslint-disable-next-line no-console
				console.log(`${kNode} 未匹配到主版本 "${params[kNode]}"，请从完整列表选择:`);
				nodePicked = await pickChoiceInteractively(params[kNode], allNodeChoices, kNode);
			}
			if (nodePicked && nodePicked !== params[kNode]) {
				// eslint-disable-next-line no-console
				console.log(`${kNode} 主版本匹配: ${params[kNode]} -> ${nodePicked}`);
				params[kNode] = nodePicked;
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.log(`${kNode} 模糊匹配跳过: ${e?.message || e}`);
		}
	}

	const requireProject = shouldRequireProject(server.alias, job);
	if (requireProject || params[kProject]) {
		try {
			const projectChoices = uniqueNonEmpty(await getChoicesFromConfigXml(server, job, kProject));
			if (projectChoices.length === 0) {
				throw new Error(`未读取到 ${kProject} 候选列表`);
			}

			let picked = null;
			if (params[kProject]) {
				const candidates = fuzzyFindChoices(params[kProject], projectChoices);
				if (candidates.length > 0) {
					picked = await pickChoiceInteractively(params[kProject], candidates, kProject);
				} else if (requireProject) {
					// eslint-disable-next-line no-console
					console.log(`${kProject} 未匹配到 "${params[kProject]}"，请从完整列表选择:`);
					picked = await pickChoiceInteractively(params[kProject], projectChoices, kProject);
				}
			} else if (requireProject) {
				// eslint-disable-next-line no-console
				console.log(`${kProject} 为必选参数，请从列表选择:`);
				picked = await pickChoiceInteractively("", projectChoices, kProject);
			}

			if (requireProject) {
				if (!picked) {
					throw new Error(`未选择 ${kProject}，无法继续构建`);
				}
				if (params[kProject] !== picked) {
					// eslint-disable-next-line no-console
					console.log(`${kProject} 选择结果: ${params[kProject] ?? "(未传)"} -> ${picked}`);
				}
				params[kProject] = picked;
			} else if (picked && params[kProject] !== picked) {
				// eslint-disable-next-line no-console
				console.log(`${kProject} 模糊匹配: ${params[kProject]} -> ${picked}`);
				params[kProject] = picked;
			}
		} catch (e) {
			if (requireProject) {
				throw new Error(`${kProject} 处理失败: ${e?.message || e}`);
			}
			// eslint-disable-next-line no-console
			console.log(`${kProject} 模糊匹配跳过: ${e?.message || e}`);
		}
	}

	// eslint-disable-next-line no-console
	console.log(`使用服务器: ${server.alias} (${server.baseUrl})`);
	// eslint-disable-next-line no-console
	console.log(`Job: ${job}`);
	// eslint-disable-next-line no-console
	console.log(`参数: ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(", ")}`);

	const queueLocation = await triggerBuild(server, job, params, {authHeader, crumb});
	// eslint-disable-next-line no-console
	console.log(`已进入队列: ${queueLocation}`);

	const {buildUrl, buildNumber} = await waitForExecutable(queueLocation, {
		authHeader,
		serverBaseUrl: server.baseUrl,
		intervalMs: args.intervalMs
	});
	// eslint-disable-next-line no-console
	console.log(`开始构建: #${buildNumber} ${buildUrl}`);

	const {result} = await monitorBuild(buildUrl, {
		authHeader,
		intervalMs: args.intervalMs,
		printConsole: args.console
	});

	// eslint-disable-next-line no-console
	console.log(`构建结束: result=${result}`);
	process.exit(result === "SUCCESS" ? 0 : 1);
}

main().catch((err) => {
	// eslint-disable-next-line no-console
	console.error(err?.stack || String(err));
	process.exit(2);
});

