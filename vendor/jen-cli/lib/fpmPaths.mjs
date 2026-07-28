import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Must match Tauri `identifier` in tauri.conf.json (app_config_dir). */
const FPM_APP_ID = "com.fpm.desktop";

/** Frontend Project Manager user config directory. */
export function fpmConfigDir() {
	if (process.platform === "win32") {
		const base =
			process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
		return path.join(base, FPM_APP_ID);
	}
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", FPM_APP_ID);
	}
	const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
	return path.join(xdg, FPM_APP_ID);
}

/**
 * Resolve jenkins.config.json when not passed via --config / env.
 * Prefers the FPM settings file so system-PATH / npm script-shell work.
 */
export function resolveJenkinsConfigPath(repoRootFallback) {
	const env = process.env.JENKINS_CONFIG_PATH;
	if (env && String(env).trim()) {
		return path.resolve(String(env).trim());
	}
	const fpm = path.join(fpmConfigDir(), "jenkins.config.json");
	if (fs.existsSync(fpm)) return fpm;
	return path.resolve(repoRootFallback, "jenkins.config.json");
}

/** Path to jen-cli.defaults.json written by FPM settings (or null). */
export function resolveJenDefaultsPath() {
	const env = process.env.FPM_JEN_CLI_DEFAULTS;
	if (env && String(env).trim()) {
		const p = path.resolve(String(env).trim());
		if (fs.existsSync(p)) return p;
	}
	const fpm = path.join(fpmConfigDir(), "jen-cli.defaults.json");
	if (fs.existsSync(fpm)) return fpm;
	return null;
}
