import fs from "node:fs";

export const HUAWEI_NPM_REGISTRY = "https://repo.huaweicloud.com/repository/npm";

export function ensureTrailingSlash(u) {
	return u.endsWith("/") ? u : `${u}/`;
}

export function jobToUrlPath(jobName) {
	return String(jobName)
	.split("/")
	.filter(Boolean)
	.map((seg) => `job/${encodeURIComponent(seg)}`)
	.join("/");
}

export function loadConfigFromFile(configPath) {
	if (!fs.existsSync(configPath)) {
		throw new Error(`找不到配置文件: ${configPath}`);
	}
	const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
	if (!cfg?.servers || typeof cfg.servers !== "object") {
		throw new Error("配置文件格式不正确，必须包含 servers 字段");
	}
	return cfg;
}

export function pickServer(cfg, alias) {
	const servers = cfg.servers ?? {};
	const keys = Object.keys(servers);
	const effective = alias ?? cfg.defaultServer ?? keys[0];
	if (!effective) throw new Error("配置文件中未找到任何 servers");
	const s = servers[effective];
	if (!s) throw new Error(`未找到 server: ${effective}`);
	if (!s.baseUrl || !s.username || !s.apiToken) {
		throw new Error(`server(${effective}) 缺少 baseUrl/username/apiToken`);
	}
	return {
		alias: effective,
		baseUrl: ensureTrailingSlash(String(s.baseUrl)),
		username: String(s.username),
		apiToken: String(s.apiToken)
	};
}

/**
 * Jenkins 返回的 Location / executable.url 往往使用「Jenkins 全局配置的根地址」。
 * 若该地址为 http://127.0.0.1:8080 等，在 Docker 容器内会指向容器自身而非真实 Jenkins，导致长时间无响应或失败。
 * 将协议与 host（含端口）改为与配置文件中的 baseUrl 一致，保留 path/query/hash。
 */
export function alignJenkinsResourceUrl(resourceUrl, serverBaseUrl) {
	if (!resourceUrl || !serverBaseUrl) return resourceUrl;
	const base = new URL(ensureTrailingSlash(String(serverBaseUrl)));
	let loc;
	try {
		loc = new URL(String(resourceUrl).trim(), base);
	} catch {
		return resourceUrl;
	}
	if (loc.origin === base.origin) return loc.href;
	const aligned = new URL(loc.href);
	aligned.protocol = base.protocol;
	aligned.host = base.host;
	return aligned.href;
}

export function basicAuthHeader(username, apiToken) {
	return `Basic ${Buffer.from(`${username}:${apiToken}`, "utf8").toString("base64")}`;
}

const JENKINS_HTTP_TIMEOUT_MS = Math.max(3000, Number(process.env.JENKINS_HTTP_TIMEOUT_MS || "15000") || 15000);

async function fetchWithTimeout(url, {method = "GET", headers, body} = {}) {
	try {
		return await fetch(url, {
			method,
			headers,
			body,
			signal: AbortSignal.timeout(JENKINS_HTTP_TIMEOUT_MS)
		});
	} catch (e) {
		if (e?.name === "TimeoutError" || e?.name === "AbortError") {
			throw new Error(`请求超时(${JENKINS_HTTP_TIMEOUT_MS}ms): ${method} ${url}`);
		}
		throw e;
	}
}

export async function fetchJson(url, {headers, method = "GET", body} = {}) {
	const res = await fetchWithTimeout(url, {method, headers, body});
	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}\n${txt}`.trim());
	}
	return await res.json();
}

export async function tryFetchText(url, {headers, method = "GET", body} = {}) {
	const res = await fetchWithTimeout(url, {method, headers, body});
	const text = await res.text().catch(() => "");
	return {ok: res.ok, status: res.status, statusText: res.statusText, text};
}

export function decodeXmlEntities(input) {
	return String(input)
	.replace(/&lt;/g, "<")
	.replace(/&gt;/g, ">")
	.replace(/&quot;/g, '"')
	.replace(/&apos;/g, "'")
	.replace(/&amp;/g, "&");
}

export function parseScriptReturnArray(scriptText) {
	const m = String(scriptText).match(/return\s*\[([\s\S]*?)]/i);
	if (!m) return [];
	const out = [];
	const re = /(["'])((?:\\.|(?!\1)[\s\S])*)\1/g;
	let hit;
	while ((hit = re.exec(m[1])) !== null) {
		const value = hit[2]
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\")
		.trim();
		if (value) out.push(decodeXmlEntities(value));
	}
	return [...new Set(out)];
}

const PARAMETER_DEFINITION_BLOCK_RE =
	/<(org\.biouno\.unochoice\.ChoiceParameter|[A-Za-z0-9_.]+ParameterDefinition)\b[\s\S]*?<\/\1>/g;

function extractDefaultValueFromParameterBlock(block) {
	const raw = decodeXmlEntities(block.match(/<defaultValue>([\s\S]*?)<\/defaultValue>/i)?.[1] ?? "").trim();
	return raw;
}

/**
 * 从 config.xml 中提取所有参数字段（含默认值）。
 */
export function listBuildParamFieldsFromConfigXml(xmlText) {
	const xml = String(xmlText ?? "");
	const sections = [...xml.matchAll(/<parameterDefinitions>([\s\S]*?)<\/parameterDefinitions>/gi)];
	const out = [];
	const seen = new Set();
	for (const section of sections) {
		const content = section[1] ?? "";
		PARAMETER_DEFINITION_BLOCK_RE.lastIndex = 0;
		let match;
		while ((match = PARAMETER_DEFINITION_BLOCK_RE.exec(content)) !== null) {
			const block = match[0];
			const name = decodeXmlEntities(block.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? "").trim();
			if (!name || seen.has(name)) continue;
			seen.add(name);
			out.push({
				name,
				defaultValue: extractDefaultValueFromParameterBlock(block)
			});
		}
	}
	return out;
}

/**
 * config.xml 是否声明了构建参数（含当前解析器未识别的参数类型）。
 * 仅当完全无 parameterDefinitions 子内容时才视为无参 Job，可安全走 POST .../build。
 */
export function configXmlDeclaresBuildParameters(xmlText) {
	if (listBuildParamFieldsFromConfigXml(xmlText).length > 0) return true;
	const xml = String(xmlText ?? "");
	for (const section of xml.matchAll(/<parameterDefinitions>([\s\S]*?)<\/parameterDefinitions>/gi)) {
		const inner = (section[1] ?? "").trim();
		if (inner && /<[^/?!]/.test(inner)) return true;
	}
	return false;
}

function extractStaticChoicesFromParameterBlock(block) {
	const values = [];
	for (const sm of block.matchAll(/<script>([\s\S]*?)<\/script>/gi)) {
		values.push(...parseScriptReturnArray(decodeXmlEntities(sm[1])));
	}
	const choicesMatch = block.match(/<choices\b[^>]*>([\s\S]*?)<\/choices>/i);
	if (choicesMatch) {
		for (const str of choicesMatch[1].matchAll(/<string>([\s\S]*?)<\/string>/gi)) {
			const v = decodeXmlEntities(str[1]).trim();
			if (v) values.push(v);
		}
	}
	return [...new Set(values.map((x) => String(x).trim()).filter(Boolean))];
}

/**
 * 从 config.xml 中查找参数定义：返回 Jenkins descriptorByName 用的完整类名（XML 根标签名）与静态候选。
 */
export function findParameterDefinitionInConfigXml(xmlText, paramName) {
	const xml = String(xmlText);
	const want = String(paramName ?? "").trim();
	if (!want) return null;
	const sections = [...xml.matchAll(/<parameterDefinitions>([\s\S]*?)<\/parameterDefinitions>/gi)];
	for (const section of sections) {
		const content = section[1] ?? "";
		PARAMETER_DEFINITION_BLOCK_RE.lastIndex = 0;
		let match;
		while ((match = PARAMETER_DEFINITION_BLOCK_RE.exec(content)) !== null) {
			const block = match[0];
			const tag = match[1];
			const name = decodeXmlEntities(block.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? "").trim();
			if (name !== want) continue;
			return {tag, block, staticChoices: extractStaticChoicesFromParameterBlock(block)};
		}
	}
	return null;
}

function normalizeFillValueItemEntry(entry) {
	if (entry == null) return null;
	if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
		const s = String(entry).trim();
		return s || null;
	}
	if (typeof entry === "object") {
		const v =
			entry.value ??
			entry.name ??
			entry.ref ??
			entry.text ??
			entry.label ??
			entry.displayName ??
			entry.option ??
			entry.key ??
			entry.id ??
			entry.branch ??
			entry.revision;
		if (v != null && String(v).trim()) return String(v).trim();
	}
	return null;
}

/**
 * 解析 Jenkins 参数填充接口返回的 JSON（如 Git Parameter、Cascade 等），尽量兼容多种字段形态。
 */
export function parseFillValueItemsPayload(data) {
	const errors = [];
	const out = [];
	const pushErr = (x) => {
		if (x == null) return;
		const s = String(x).trim();
		if (s) errors.push(s);
	};

	if (data == null) return {values: [], errors};

	if (Array.isArray(data.errors)) for (const e of data.errors) pushErr(typeof e === "string" ? e : e?.message ?? e?.msg ?? JSON.stringify(e));

	const collectArray = (arr) => {
		if (!Array.isArray(arr)) return;
		for (const item of arr) {
			const n = normalizeFillValueItemEntry(item);
			if (n) out.push(n);
		}
	};

	collectArray(data.values);
	collectArray(data.choices);
	collectArray(data.options);
	collectArray(data.items);

	if (out.length === 0 && Array.isArray(data)) collectArray(data);

	if (typeof data === "object" && !Array.isArray(data)) {
		for (const k of [
			"results",
			"tags",
			"branches",
			"branchNames",
			"refs",
			"entries",
			"rows",
			"data",
			"suggestions",
			"allTags",
			"tagList",
			"names"
		]) {
			collectArray(data[k]);
		}
	}

	return {values: [...new Set(out)], errors};
}

export async function fetchFillValueItemsJson(server, jobName, descriptorFqcn, paramName) {
	const jobPath = jobToUrlPath(jobName);
	const pathSeg = encodeURIComponent(String(descriptorFqcn ?? "").trim());
	if (!pathSeg) throw new Error("descriptor 类名为空");
	const p = String(paramName ?? "").trim();
	if (!p) throw new Error("参数名为空");

	const u = new URL(`${jobPath}/descriptorByName/${pathSeg}/fillValueItems`, server.baseUrl);
	u.searchParams.set("param", p);

	const authHeader = basicAuthHeader(server.username, server.apiToken);
	const res = await fetchWithTimeout(u.toString(), {
		headers: {Authorization: authHeader, Accept: "application/json,*/*"}
	});
	const text = await res.text().catch(() => "");
	let json;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	return {ok: res.ok, status: res.status, statusText: res.statusText, url: u.toString(), text, json};
}

export async function fetchJobConfigXml(server, jobName) {
	const jobPath = jobToUrlPath(jobName);
	const url = new URL(`${jobPath}/config.xml`, server.baseUrl).toString();
	const authHeader = basicAuthHeader(server.username, server.apiToken);
	const res = await tryFetchText(url, {headers: {Authorization: authHeader}});
	if (!res.ok) throw new Error(`读取 config.xml 失败: HTTP ${res.status} ${res.statusText}`);
	return res.text;
}

export async function getBuildParamFieldsFromConfigXml(server, jobName) {
	const xml = await fetchJobConfigXml(server, jobName);
	return listBuildParamFieldsFromConfigXml(xml);
}

export async function getChoicesFromConfigXml(server, jobName, key, opts = {}) {
	const onFillWarnings = typeof opts.onFillWarnings === "function" ? opts.onFillWarnings : null;
	const xml = await fetchJobConfigXml(server, jobName);
	const k = String(key ?? "").trim();
	if (!k) return [];

	const meta = findParameterDefinitionInConfigXml(xml, k);
	if (!meta) {
		throw new Error(`config.xml 中未找到名为 "${k}" 的参数定义`);
	}

	if (meta.staticChoices.length > 0) return meta.staticChoices;

	const res = await fetchFillValueItemsJson(server, jobName, meta.tag, k);
	if (!res.ok) {
		const snippet = (res.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
		throw new Error(
			`动态列表请求失败: HTTP ${res.status} ${res.statusText}\nURL: ${res.url}${snippet ? `\n响应片段: ${snippet}` : ""}`
		);
	}

	if (res.json == null) {
		const snippet = (res.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
		throw new Error(`动态列表返回非 JSON，无法解析\nURL: ${res.url}${snippet ? `\n响应片段: ${snippet}` : ""}`);
	}

	const parsed = parseFillValueItemsPayload(res.json);
	if (parsed.errors.length > 0 && parsed.values.length === 0) {
		throw new Error(`参数 "${k}" 列表接口报错:\n${parsed.errors.map((e) => `  - ${e}`).join("\n")}`);
	}
	if (parsed.errors.length > 0 && onFillWarnings) onFillWarnings(parsed.errors);

	return parsed.values;
}

export async function tryGetCrumb(server, authHeader) {
	const url = new URL("crumbIssuer/api/json", server.baseUrl).toString();
	try {
		const j = await fetchJson(url, {headers: {Authorization: authHeader}});
		if (j?.crumbRequestField && j?.crumb) return {field: j.crumbRequestField, crumb: j.crumb};
	} catch {
		// ignore
	}
	return null;
}

export async function triggerBuild(server, jobName, params, {authHeader, crumb} = {}) {
	const jobPath = jobToUrlPath(jobName);

	// 无构建参数的 Job 必须使用 POST .../build；对 buildWithParameters 发空表单时 Jenkins 常返回 500
	let hasParamDefinitions = true;
	try {
		const xml = await fetchJobConfigXml(server, jobName);
		hasParamDefinitions = configXmlDeclaresBuildParameters(xml);
	} catch {
		hasParamDefinitions = true;
	}

	const headers = {Authorization: authHeader};
	if (crumb) headers[crumb.field] = crumb.crumb;

	let buildUrl;
	let body;
	if (!hasParamDefinitions) {
		buildUrl = new URL(`${jobPath}/build`, server.baseUrl);
	} else {
		buildUrl = new URL(`${jobPath}/buildWithParameters`, server.baseUrl);
		const sp = new URLSearchParams();
		for (const [k, v] of Object.entries(params ?? {})) sp.set(k, String(v));
		headers["Content-Type"] = "application/x-www-form-urlencoded";
		body = sp.toString();
	}

	const res = await fetchWithTimeout(buildUrl.toString(), {method: "POST", headers, body});
	if (!(res.status === 200 || res.status === 201)) {
		const txt = await res.text().catch(() => "");
		throw new Error(`触发构建失败: HTTP ${res.status} ${res.statusText}\n${txt}`.trim());
	}
	const rawLocation = res.headers.get("location");
	if (!rawLocation) throw new Error("触发成功但未返回队列地址");
	return alignJenkinsResourceUrl(rawLocation, server.baseUrl);
}

export function parseQueueItemId(queueLocation) {
	const m = String(queueLocation ?? "").match(/\/queue\/item\/(\d+)\/?$/);
	return m ? m[1] : null;
}

export async function cancelQueueItem(server, queueLocation, {authHeader, crumb} = {}) {
	const queueId = parseQueueItemId(queueLocation);
	if (!queueId) {
		throw new Error("无法从队列地址解析 queueId");
	}
	const url = new URL(`queue/cancelItem`, server.baseUrl);
	url.searchParams.set("id", queueId);
	const headers = {Authorization: authHeader};
	if (crumb) headers[crumb.field] = crumb.crumb;
	const res = await fetchWithTimeout(url.toString(), {method: "POST", headers});
	if (!(res.status === 200 || res.status === 201 || res.status === 302)) {
		const txt = await res.text().catch(() => "");
		throw new Error(`取消队列任务失败: HTTP ${res.status} ${res.statusText}\n${txt}`.trim());
	}
	return {queueId};
}

export async function stopBuild(server, buildUrl, {authHeader, crumb} = {}) {
	const stopUrl = new URL("stop", ensureTrailingSlash(buildUrl)).toString();
	const headers = {Authorization: authHeader};
	if (crumb) headers[crumb.field] = crumb.crumb;
	const res = await fetchWithTimeout(stopUrl, {method: "POST", headers});
	if (!(res.status === 200 || res.status === 201 || res.status === 302)) {
		const txt = await res.text().catch(() => "");
		throw new Error(`终止构建失败: HTTP ${res.status} ${res.statusText}\n${txt}`.trim());
	}
	return {ok: true};
}

export function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

export async function waitForExecutable(queueLocation, {authHeader, serverBaseUrl, intervalMs = 3000} = {}) {
	const apiUrl = queueLocation.endsWith("/") ? `${queueLocation}api/json` : `${queueLocation}/api/json`;
	while (true) {
		const j = await fetchJson(apiUrl, {headers: {Authorization: authHeader}});
		if (j?.cancelled) throw new Error("队列任务被取消");
		if (j?.executable?.url && typeof j?.executable?.number === "number") {
			const buildUrl = alignJenkinsResourceUrl(j.executable.url, serverBaseUrl);
			return {buildUrl, buildNumber: j.executable.number};
		}
		await sleep(intervalMs);
	}
}

export async function getBuildInfo(buildUrl, authHeader) {
	const apiUrl = buildUrl.endsWith("/") ? `${buildUrl}api/json` : `${buildUrl}/api/json`;
	const maxRetries = 3;
	const retryDelayMs = 2000;
	let lastError;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fetchJson(apiUrl, {headers: {Authorization: authHeader}});
		} catch (e) {
			const message = String(e?.message || e);
			const isTimeout = message.startsWith("请求超时(");
			if (!isTimeout || attempt >= maxRetries) throw e;
			lastError = e;
			await sleep(retryDelayMs);
		}
	}

	throw lastError;
}

function buildNestedJobsTree(depth) {
	if (depth <= 1) return "jobs[name,fullName,_class]";
	return `jobs[name,fullName,_class,${buildNestedJobsTree(depth - 1)}]`;
}

/**
 * 将 Jenkins /api/json 返回的 jobs 树展开为 fullName 列表（尽量识别 Folder）。
 */
export function flattenJobFullNames(rootJobs) {
	const acc = [];
	function walk(jobs) {
		for (const item of jobs || []) {
			const cls = String(item._class || "");
			const isFolder =
				cls.includes("com.cloudbees.hudson.plugins.folder.Folder") || /\.Folder$/.test(cls);
			if (isFolder && Array.isArray(item.jobs) && item.jobs.length > 0) {
				walk(item.jobs);
			} else if (!isFolder && (item.fullName || item.name)) {
				acc.push(String(item.fullName || item.name));
			}
		}
	}
	walk(rootJobs);
	return [...new Set(acc)].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

/**
 * 列出 Jenkins 上可见的 Job 全名（嵌套深度由 depth 控制，默认 8 层 folder）。
 */
export async function listJobFullNames(server, authHeader, {depth = 8} = {}) {
	const tree = buildNestedJobsTree(depth);
	const url = new URL(`api/json`, server.baseUrl);
	url.searchParams.set("tree", tree);
	const j = await fetchJson(url.toString(), {headers: {Authorization: authHeader}});
	return flattenJobFullNames(j.jobs);
}

export async function readProgressiveText(buildUrl, authHeader, start) {
	const u = new URL("logText/progressiveText", ensureTrailingSlash(buildUrl));
	u.searchParams.set("start", String(start));
	const res = await fetchWithTimeout(u.toString(), {headers: {Authorization: authHeader}});
	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`读取控制台失败: HTTP ${res.status} ${res.statusText}\n${txt}`.trim());
	}
	const text = await res.text();
	const sizeHeader = res.headers.get("x-text-size");
	const moreHeader = res.headers.get("x-more-data");
	const next = sizeHeader ? Number(sizeHeader) : start + text.length;
	return {text, nextStart: Number.isFinite(next) ? next : start, more: moreHeader === "true"};
}
