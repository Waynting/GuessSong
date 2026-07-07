# GuessSong Android PWA + Web Share Target 實作規格

> 定位:activation 功能──縮短「在 Spotify 看到歌單 → 開始玩」的路徑到兩步(分享 → 選 GuessSong)。
>
> **關鍵前提:share target 只對已安裝 PWA 的用戶生效。** 沒裝就不會出現在系統分享面板。所以本功能實際是兩件事:(1) 把 GuessSong 做成可安裝的 PWA + 安裝引導,(2) share target 本體。前者決定後者的觸及量。

---

## 1. 用戶流程

```
[前置] 用戶在 GuessSong 玩過 → 看到安裝引導 → 安裝 PWA(WebAPK)
                                        │
[日常] Spotify App 看到歌單 → 分享 → 系統分享面板出現 GuessSong
                                        │
        GuessSong /share 接收 → 解析歌單 ID → 302 至 /play/{id} → 直接開玩
```

## 2. PWA 可安裝性(前置工程)

### 2.1 Manifest 必要欄位

```json
// public/manifest.json
{
  "name": "GuessSong — 猜歌派對遊戲",
  "short_name": "GuessSong",
  "start_url": "/?utm_source=pwa",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#0f0f0f",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "share_target": {
    "action": "/share",
    "method": "GET",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url"
    }
  }
}
```

注意:
- `display` 不能是 `browser`,否則不可安裝。
- `share_target.action` 必須在 manifest `scope` 內(預設 scope 為 `/`,即可)。
- Android 上 Chrome 會把達標的 PWA 鑄成 **WebAPK**,share target 是在 WebAPK 安裝完成後才註冊進系統分享面板;安裝後偶爾要幾分鐘才生效,測試時別誤判為壞掉。

### 2.2 Service Worker

share target(GET 模式)不需要 SW 攔截,但**可安裝性要求站點註冊一個 SW 且有 fetch handler**。最小可行:

```ts
// public/sw.js — 最小殼,不做離線快取(遊戲本身依賴網路)
self.addEventListener('fetch', () => {});
```

之後若要離線 shell / 快取靜態資源再擴充(next-pwa 或 serwist 皆可,MVP 不必)。

### 2.3 為什麼用 GET 而不是 POST

- Spotify 分享出來的是純文字連結,沒有檔案,GET query string 足夠。
- GET 可以用 Next.js **route handler 直接 302**,不需要落地一個中轉頁面,體感最快;POST share target 需要 SW 或表單端點處理,複雜度白增。

## 3. `/share` 端點實作

### 3.1 Spotify 分享內容的實際格式(重要坑)

Android 上 Spotify 分享歌單時,**URL 通常放在 `text` 參數而不是 `url` 參數**(Android 分享 intent 的 EXTRA_TEXT),而且常帶前綴文字。三個參數都要掃。可能遇到的格式:

| 來源 | 範例 |
|---|---|
| 標準連結 | `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...` |
| 語系路徑 | `https://open.spotify.com/intl-zh-tw/playlist/37i9...` |
| 短連結 | `https://spotify.link/AbCdEfG`(需追 redirect 才知道目標) |
| 帶前綴文字 | `來聽聽這個歌單! https://open.spotify.com/playlist/...` |
| 非歌單 | track / album / artist 連結(用戶手滑分享錯型別) |

### 3.2 Route Handler

```ts
// app/share/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PLAYLIST_RE =
  /open\.spotify\.com\/(?:intl-[\w-]+\/)?playlist\/([A-Za-z0-9]{22})/;
const SHORTLINK_RE = /https?:\/\/spotify\.link\/\w+/;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const raw = [p.get('url'), p.get('text'), p.get('title')]
    .filter(Boolean).join(' ');

  let match = raw.match(PLAYLIST_RE);

  // 短連結:server 端追 redirect(client 追會被 CORS 擋)
  if (!match) {
    const short = raw.match(SHORTLINK_RE)?.[0];
    if (short) {
      const res = await fetch(short, { method: 'HEAD', redirect: 'follow' });
      match = res.url.match(PLAYLIST_RE);
    }
  }

  if (match) {
    return NextResponse.redirect(
      new URL(`/play/${match[1]}?utm_source=share_target`, req.url), 302
    );
  }

  // 解析失敗:track/album/亂文字 → 落到友善錯誤頁
  return NextResponse.redirect(
    new URL(`/share/unsupported?raw=${encodeURIComponent(raw.slice(0, 200))}`,
    req.url), 302
  );
}
```

### 3.3 非歌單型別的處理(`/share/unsupported`)

不要只丟「不支援」。分型別給出路:
- **track 連結** → 「這是單曲,GuessSong 需要歌單。這首歌所在的官方歌單有:…」(可用 Spotify API 搜相關歌單,或至少引導回首頁的熱門歌單)。
- **album 連結** → 直接支援其實不難(album tracks 一樣能出題),可列入 backlog;短期先顯示「即將支援專輯,先試試這些歌單」。
- **私人歌單**(API 抓不到)→ 明確告知「歌單需設為公開」,附 Spotify 設公開的教學截圖。

這個頁面值得埋 `share_unsupported` 事件並記錄型別分佈——如果 album 佔比高,就是下一個功能的免費 roadmap 依據。

## 4. 安裝引導(決定 share target 觸及量的關鍵)

### 4.1 時機

`beforeinstallprompt` 事件攔截後**不要立刻彈**,存起來,在高情緒點才觸發:

1. **遊戲結算畫面**(主要):「下次在 Spotify 看到好歌單,分享給 GuessSong 就能直接開玩」+ 安裝按鈕。
2. 第二次造訪的首頁 banner(次要)。

```ts
let deferredPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

async function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  track('pwa_install_prompt', { outcome });   // accepted / dismissed
  deferredPrompt = null;
}
```

### 4.2 賣點文案

安裝引導不要說「安裝 App」(用戶對這句話免疫),說**功能利益**:「在 Spotify 按分享,直接把歌單變成猜歌遊戲」──配一張兩步驟示意圖(Spotify 分享面板 → GuessSong 圖示)。這個示意圖本身也是好素材,可同步發到社群當功能宣傳。

## 5. 測試清單

| 項目 | 方法 |
|---|---|
| 可安裝性 | Chrome DevTools → Application → Manifest,無錯誤;Lighthouse PWA 檢查 |
| WebAPK 狀態 | Android Chrome 開 `chrome://webapks`,確認已鑄造、share target 已註冊 |
| Spotify 實分享 | 真機從 Spotify App 分享:標準歌單 / intl 路徑 / spotify.link 短連結 / track / album / 私人歌單,六種都走一遍 |
| 更新傳播 | manifest 改動後 WebAPK 更新有延遲(Chrome 週期性檢查),share_target 參數改動要預期數天的舊版共存 |
| 桌面不受影響 | share_target 對桌面 Chrome 無害,但確認 manifest 改動沒弄壞既有安裝 |

## 6. 指標

| 指標 | 事件 | 說明 |
|---|---|---|
| 安裝率 | `pwa_install_prompt` outcome=accepted / 引導曝光 | 決定 share target 的觸及天花板 |
| Share target 進站 | `/play` session 帶 `utm_source=share_target` | 功能本身的使用量 |
| 解析失敗率 | `share_unsupported` / share 進站總數 | > 20% 代表格式解析有漏 |
| 安裝者留存 | PWA 用戶 vs 瀏覽器用戶的 7 日回訪 | 驗證「裝了就更常玩」的假設 |

## 7. 範圍界定

- **iOS**:本規格不處理。iOS PWA 無 share target;iOS 用戶的低摩擦路徑是「捷徑(Shortcuts)分享表單」──可做一個接收 URL 的捷徑範本讓用戶一鍵加入,成本極低,可當 backlog 實驗,但別期待量。
- **原生 Android App**:除非 PWA 版驗證出高安裝率 + 高 share target 使用率,否則不上 Play Store(上架審查與維護成本不值得)。
- 工期估算:PWA 化 + share 端點 + 安裝引導,約 3–4 個工作天,其中真機測試佔至少 1 天。
