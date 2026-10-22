// Доступ к стене без аккаунта: vk.ru выдаёт каждому визиту анонимный токен (JWT `anonym.…`,
// живёт сутки), с ним веб-клиент сам вызывает wall.get. Берём токен так же — открываем паблик
// в чистом профиле Chrome и перехватываем его из запросов страницы.
import { chromium } from "playwright-core";

const API = "https://api.vk.ru/method/wall.get?v=5.199&client_id=6287487";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchAnonymousToken = async (domain) => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ locale: "ru-RU" });
    let token = null;
    page.on("request", (request) => {
      const match = `${request.url()} ${request.postData() ?? ""}`.match(/access_token=(anonym\.[\w.-]+)/);
      if (match) token ??= match[1];
    });
    await page.goto(`https://vk.ru/${domain}`, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 30 && !token; i++) {
      await page.waitForTimeout(1000);
      // часть страниц грузит стену только после прокрутки
      if (i === 8) await page.mouse.wheel(0, 4000);
    }
    if (!token) throw new Error("vk.ru не выдал анонимный токен");
    return token;
  } finally {
    await browser.close();
  }
};

export const createWallClient = ({ domain, log }) => {
  let token = null;

  const getWall = async (params) => {
    for (let attempt = 0; ; attempt++) {
      token ??= await fetchAnonymousToken(domain);
      let data;
      try {
        const response = await fetch(API, {
          method: "POST",
          body: new URLSearchParams({ ...params, access_token: token }),
          headers: { Referer: "https://vk.ru/" },
          signal: AbortSignal.timeout(60_000),
        });
        data = await response.json();
      } catch (error) {
        log(`сеть: ${error}`);
        await sleep(30_000);
        continue;
      }
      if (data.response) return data.response;

      const code = data.error?.error_code;
      log(`VK ${code}: ${data.error?.error_msg}`);
      if (code === 5 || code === 1116) token = null; // токен протух — возьмём новый
      else if (code === 6) await sleep(5_000); // слишком часто
      else if (code === 9 || code === 29) await sleep(15 * 60_000); // flood/лимит: ждём окна, а не долбим
      else if (code === 14) throw new Error("VK требует капчу — сбор остановлен");
      else if (attempt >= 5) throw new Error(`VK ${code}: ${data.error?.error_msg}`);
      else await sleep(30_000);
    }
  };

  return { getWall };
};
