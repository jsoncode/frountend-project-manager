import fs from "node:fs";
import { HUAWEI_NPM_REGISTRY } from "./jenkins.mjs";
import { resolveJenDefaultsPath } from "./fpmPaths.mjs";

export function parseSemverFromCandidate(v) {
	const m = String(v).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
	if (!m) return null;
	return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function cmpSemver(a, b) {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	return a.patch - b.patch;
}

export function normalizeNodeVersion(input) {
	if (input == null) return input;
	const raw = String(input).trim();
	if (!raw) return input;

	const full = raw.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
	if (full) {
		return `v${full[1]}.${full[2]}.${full[3]}`;
	}

	const majorOnly = raw.match(/^v?(\d+)$/);
	if (majorOnly) {
		return `v${majorOnly[1]}`;
	}

	return input;
}

export function extractNodeMajor(input) {
	if (input == null) return null;
	const raw = String(input).trim();
	if (!raw) return null;
	const m = raw.match(/^v?(\d+)(?:\.\d+\.\d+)?$/i);
	if (!m) return null;
	const major = Number(m[1]);
	return Number.isFinite(major) ? major : null;
}

export function uniqueNonEmpty(list) {
	return [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).trim()).filter(Boolean))];
}

export function fuzzyFindNodeVersionByMajor(rawInput, choices) {
	const major = extractNodeMajor(rawInput);
	if (major == null || !Array.isArray(choices) || choices.length === 0) return [];
	return uniqueNonEmpty(
		choices
			.filter((v) => {
				const s = parseSemverFromCandidate(v);
				return s && s.major === major;
			})
			.sort((a, b) => {
				const sa = parseSemverFromCandidate(a);
				const sb = parseSemverFromCandidate(b);
				if (sa && sb) return cmpSemver(sb, sa);
				return String(a).localeCompare(String(b), "zh-CN");
			})
	);
}

export function normalizeInstallCommand(cmd) {
	if (cmd == null) return cmd;
	const s = String(cmd).trim();
	if (!s) return cmd;
	if (/\s--registry(\s|=)?/.test(s)) {
		return cmd.replace(/\s*--registry(=(null|0))?/, "");
	}
	if (/^(pnpm|npm)\s+(i|install)(\s+.*)?$/i.test(s)) {
		return `${s} --registry ${HUAWEI_NPM_REGISTRY}`;
	}
	return cmd;
}

const FALLBACK_DEFAULTS = {
	cliDefaults: {
		server: "tx",
		job: "",
		intervalMs: 3000,
		console: true
	},
	paramKeys: {},
	paramDefaults: {
		branch: "uat5",
		NodeVersion: "v24.12.0",
		INSTALL_COMMAND_ACTIVE: "pnpm i",
		BUILD_COMMAND_ACTIVE: "pnpm build:uat",
		project: ""
	},
	presets: { rules: [] }
};

let cachedDefaults = null;

export function loadJenDefaults() {
	if (cachedDefaults) return cachedDefaults;
	const p = resolveJenDefaultsPath();
	if (p && fs.existsSync(p)) {
		try {
			const raw = JSON.parse(fs.readFileSync(p, "utf8"));
			cachedDefaults = {
				...FALLBACK_DEFAULTS,
				...raw,
				// Respect explicit file contents (including empty {}) so UI deletions stick.
				paramKeys:
					raw.paramKeys != null && typeof raw.paramKeys === "object"
						? { ...raw.paramKeys }
						: { ...FALLBACK_DEFAULTS.paramKeys },
				paramDefaults:
					raw.paramDefaults != null && typeof raw.paramDefaults === "object"
						? { ...raw.paramDefaults }
						: { ...FALLBACK_DEFAULTS.paramDefaults },
				cliDefaults: { ...FALLBACK_DEFAULTS.cliDefaults, ...(raw.cliDefaults || {}) },
				presets: raw.presets || FALLBACK_DEFAULTS.presets
			};
			return cachedDefaults;
		} catch {
			/* fall through */
		}
	}
	cachedDefaults = FALLBACK_DEFAULTS;
	return cachedDefaults;
}

/** Clear cache (tests / reload). */
export function resetJenDefaultsCache() {
	cachedDefaults = null;
}

export function paramKey(role) {
	const keys = loadJenDefaults().paramKeys || {};
	return keys[role] || role;
}

function matchingRules(serverAlias, jobName) {
	const rules = loadJenDefaults().presets?.rules;
	if (!Array.isArray(rules) || rules.length === 0) return [];
	const alias = String(serverAlias);
	const job = String(jobName);
	return rules.filter((r) => {
		const servers = Array.isArray(r.whenServer) ? r.whenServer.map(String) : [];
		const jobs = Array.isArray(r.whenJob) ? r.whenJob.map(String) : [];
		const serverOk = servers.length === 0 || servers.includes(alias);
		const jobOk = jobs.length === 0 || jobs.includes(job);
		return serverOk && jobOk;
	});
}

export function getDefaultJobForServer(serverAlias) {
	const rules = loadJenDefaults().presets?.rules;
	if (Array.isArray(rules)) {
		for (const r of rules) {
			const servers = Array.isArray(r.whenServer) ? r.whenServer.map(String) : [];
			if (servers.includes(String(serverAlias)) && r.defaultJob) {
				return String(r.defaultJob);
			}
		}
	}
	const fromCli = loadJenDefaults().cliDefaults?.job;
	if (fromCli) return String(fromCli);
	return "system3_Front_docker3";
}

export function shouldRequireProject(serverAlias, jobName) {
	return matchingRules(serverAlias, jobName).some((r) => Boolean(r.requireProject));
}

export function shouldApplyPresetDefaults(serverAlias, jobName) {
	const rules = matchingRules(serverAlias, jobName);
	if (rules.length > 0) return true;
	// If no rules configured, still apply global paramDefaults when any exist.
	const pd = loadJenDefaults().paramDefaults || {};
	return Object.values(pd).some((v) => String(v ?? "").trim() !== "");
}

function roleDefaultsFor(serverAlias, jobName) {
	const base = { ...(loadJenDefaults().paramDefaults || {}) };
	for (const r of matchingRules(serverAlias, jobName)) {
		if (r.defaults && typeof r.defaults === "object") {
			Object.assign(base, r.defaults);
		}
	}
	return base;
}

export function parseParams({ paramsCsv, paramKvs, serverAlias, jobName }) {
	const kvs = [];
	if (paramsCsv) {
		for (const part of String(paramsCsv).split(",")) {
			const t = part.trim();
			if (!t) continue;
			kvs.push(t);
		}
	}
	if (Array.isArray(paramKvs)) kvs.push(...paramKvs.filter(Boolean).map(String));

	const parsed = {};
	for (const kv of kvs) {
		const idx = kv.indexOf("=");
		if (idx <= 0) continue;
		const k = kv.slice(0, idx).trim();
		const v = kv.slice(idx + 1).trim();
		if (!k) continue;
		parsed[k] = v;
	}

	const kBranch = paramKey("branch");
	const kNode = paramKey("nodeVersion");
	const kInstall = paramKey("installCommand");
	const kBuild = paramKey("buildCommand");

	const applyPresetDefaults = shouldApplyPresetDefaults(serverAlias, jobName);
	let merged = { ...parsed };

	if (applyPresetDefaults) {
		const roles = roleDefaultsFor(serverAlias, jobName);
		// Prefer flattened Jenkins keys; fall back to legacy role names.
		const pick = (...keys) => {
			for (const k of keys) {
				if (k != null && parsed[k] != null && String(parsed[k]).trim() !== "") return parsed[k];
				if (k != null && roles[k] != null && String(roles[k]).trim() !== "") return roles[k];
			}
			return undefined;
		};
		const branch = pick(kBranch, "branch") ?? "uat5";
		const prodBranches = new Set(["master", "master4", "master5"]);
		const defaultBuild =
			pick(kBuild, "buildCommand", "BUILD_COMMAND_ACTIVE") ||
			(prodBranches.has(String(branch)) ? "pnpm build:prod" : "pnpm build:uat");
		merged = {
			...roles,
			[kBranch]: branch,
			[kNode]: normalizeNodeVersion(
				pick(kNode, "nodeVersion", "NodeVersion") ?? "v24.12.0",
			),
			[kInstall]:
				pick(kInstall, "installCommand", "INSTALL_COMMAND_ACTIVE") ?? "pnpm i",
			[kBuild]: defaultBuild,
			...parsed
		};
		// Drop empty legacy role-only keys that aren't real Jenkins names when
		// flattened keys already cover them (keep user-provided parsed keys).
		for (const legacy of ["nodeVersion", "installCommand", "buildCommand"]) {
			const mapped = paramKey(legacy);
			if (mapped !== legacy && legacy in merged && mapped in merged) {
				delete merged[legacy];
			}
		}
	} else if (merged[kNode] != null) {
		merged[kNode] = normalizeNodeVersion(merged[kNode]);
	} else if (merged.NodeVersion != null) {
		merged.NodeVersion = normalizeNodeVersion(merged.NodeVersion);
	}

	for (const [k, v] of Object.entries(merged)) {
		merged[k] = normalizeInstallCommand(v);
	}

	return merged;
}

export function normalizeForMatch(s) {
	return String(s).toLowerCase().replace(/[\s_-]+/g, "");
}

export function fuzzyFindChoices(rawInput, choices) {
	const input = String(rawInput ?? "").trim();
	if (!input || !Array.isArray(choices) || choices.length === 0) return [];
	const nInput = normalizeForMatch(input);
	const mapped = choices.map((c) => ({ raw: c, n: normalizeForMatch(c) }));

	const exactHits = mapped.filter((x) => x.n === nInput).map((x) => x.raw);
	if (exactHits.length > 0) return uniqueNonEmpty(exactHits);

	const includesHits = mapped.filter((x) => x.n.includes(nInput) || nInput.includes(x.n));
	if (includesHits.length > 0) {
		includesHits.sort((a, b) => {
			if (a.n.length !== b.n.length) return a.n.length - b.n.length;
			return String(a.raw).localeCompare(String(b.raw), "zh-CN");
		});
		return uniqueNonEmpty(includesHits.map((x) => x.raw));
	}

	return [];
}
