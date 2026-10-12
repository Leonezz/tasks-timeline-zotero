import { config } from "../../package.json";

const ORIGIN = `chrome://${config.addonRef}`;
const REALM = `${config.addonName} secrets`;

const LoginInfo = Components.Constructor(
  "@mozilla.org/login-manager/loginInfo;1",
  Components.interfaces.nsILoginInfo,
  "init",
) as unknown as new (
  origin: string,
  formActionOrigin: string | null,
  httpRealm: string,
  username: string,
  password: string,
  usernameField: string,
  passwordField: string,
) => nsILoginInfo;

/**
 * API keys live in Firefox's login manager (encrypted, and protected by the
 * primary password if the user set one), never in prefs.js.
 */
export class SecretStore {
  private async find(name: string): Promise<nsILoginInfo | undefined> {
    const logins = await Services.logins.searchLoginsAsync({
      origin: ORIGIN,
      httpRealm: REALM,
    });
    return logins.find((login: nsILoginInfo) => login.username === name);
  }

  async get(name: string): Promise<string> {
    return (await this.find(name))?.password ?? "";
  }

  /** Stores a secret; an empty value deletes it. */
  async set(name: string, value: string): Promise<void> {
    const existing = await this.find(name);
    if (!value) {
      if (existing) Services.logins.removeLogin(existing);
      return;
    }
    const login = new LoginInfo(ORIGIN, null, REALM, name, value, "", "");
    if (existing) {
      if (existing.password !== value)
        Services.logins.modifyLogin(existing, login);
    } else {
      await Services.logins.addLoginAsync(login);
    }
  }
}
