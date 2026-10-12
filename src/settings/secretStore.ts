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
 * Firefox 140 ESR (Zotero 9/10) only has the synchronous removeLogin /
 * modifyLogin; newer Firefox (Zotero betas) only has the async versions.
 */
interface LoginManagerWrites {
  removeLogin?: (login: nsILoginInfo) => void;
  removeLoginAsync?: (login: nsILoginInfo) => Promise<void>;
  modifyLogin?: (oldLogin: nsILoginInfo, newLogin: nsILoginInfo) => void;
  modifyLoginAsync?: (
    oldLogin: nsILoginInfo,
    newLogin: nsILoginInfo,
  ) => Promise<void>;
}

const loginWrites = () => Services.logins as unknown as LoginManagerWrites;

export async function removeLogin(login: nsILoginInfo): Promise<void> {
  const logins = loginWrites();
  if (logins.removeLoginAsync) return logins.removeLoginAsync(login);
  if (logins.removeLogin) return logins.removeLogin(login);
  throw new Error("This Zotero version's login manager can't remove logins");
}

async function modifyLogin(
  oldLogin: nsILoginInfo,
  newLogin: nsILoginInfo,
): Promise<void> {
  const logins = loginWrites();
  if (logins.modifyLoginAsync)
    return logins.modifyLoginAsync(oldLogin, newLogin);
  if (logins.modifyLogin) return logins.modifyLogin(oldLogin, newLogin);
  throw new Error("This Zotero version's login manager can't update logins");
}

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
      if (existing) await removeLogin(existing);
      return;
    }
    const login = new LoginInfo(ORIGIN, null, REALM, name, value, "", "");
    if (existing) {
      if (existing.password !== value) await modifyLogin(existing, login);
    } else {
      await Services.logins.addLoginAsync(login);
    }
  }
}
