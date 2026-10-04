import { Injectable } from "@nestjs/common";
import { ReceiptItemDto, TempleSettingsDto } from "@tms/shared";

interface ReceiptPrintData {
  receiptNo: string;
  amount: number;
  status: string;
  createdAt: string;
  issuedByName: string;
  payerName: string;
  items?: ReceiptItemDto[] | null;
}

@Injectable()
export class PrintService {
  renderReceiptHtml(data: ReceiptPrintData, settings: TempleSettingsDto, baseUrl: string): string {
    const isVoided = data.status === "VOIDED";
    const { year, month, day } = this.toRocDate(new Date(data.createdAt));

    // 印信圖片改走 GCS 後才補上 CORS 設定；瀏覽器可能仍快取著設定生效前那次失敗的請求，
    // 故加上快取破壞參數強制重新抓取，避免沿用舊的（無 CORS header）快取回應
    const cacheBust = (url: string) => `${url}${url.includes("?") ? "&" : "?"}_cb=${Date.now()}`;
    const templeSealImg = settings.templeSealImagePath
      ? `<img class="seal-img temple-seal" crossorigin="anonymous" src="${this.esc(cacheBust(settings.templeSealImagePath))}" alt="宮廟印信" />`
      : `<span class="seal-placeholder temple-seal"></span>`;
    const chairmanSealImg = settings.chairmanSealImagePath
      ? `<img class="seal-img chairman-seal" crossorigin="anonymous" src="${this.esc(cacheBust(settings.chairmanSealImagePath))}" alt="主委簽章" />`
      : `<span class="seal-placeholder chairman-seal"></span>`;

    const items = data.items ?? [];
    // 項目愈多，行距與字級愈要縮小，才能在右側固定寬度欄位內一列一項不換行
    const itemFontSize = items.length > 6 ? 11 : items.length > 3 ? 12 : 13;
    const itemsHtml =
      items.length > 0
        ? `
          <div class="cert-items">
            <p class="cert-items-title">參加項目</p>
            ${items
              .map(
                (item) =>
                  `<p class="cert-item-line" style="font-size:${itemFontSize}px;">${this.esc(item.description)}</p>` +
                  (item.amount > 0
                    ? `<p class="cert-item-amount" style="font-size:${itemFontSize}px;">NT$ ${item.amount.toLocaleString()}</p>`
                    : ""),
              )
              .join("")}
          </div>
        `
        : "";
    // 座位/燈位號碼改印在主文區塊（印信下方、經辦人資訊上方的空白處），不再擠在右側項目欄；
    // 每個燈位/座位各自獨立一行，不合併成同一行文字
    const seatNotesHtml = items
      .map((item) => item.note)
      .filter((note): note is string => !!note)
      .map((note) => `<div class="cert-seat-note">${this.esc(note)}</div>`)
      .join("");

    // 直式標籤（存根聯／收執聯）改用逐字換行堆疊，不依賴 writing-mode（部分瀏覽器的列印/PDF 引擎支援度不一，
    // 曾發生标籤沒有實際顯示出來的狀況），確保任何瀏覽器列印都能穩定顯示
    const buildCopyLabel = (label: string) =>
      `<div class="cert-copy-label">${label
        .split("")
        .map((ch) => this.esc(ch))
        .join("<br/>")}</div>`;

    const buildCopy = (copyLabel: string) => `
      <div class="cert-copy">
        ${isVoided ? '<div class="stamp">作廢 VOID</div>' : ""}
        <div class="cert-header">
          <h1 class="cert-title">感謝狀</h1>
          <div class="cert-no">NO：${this.esc(data.receiptNo)}</div>
        </div>
        <div class="cert-body">
          <div class="cert-main">
            <div class="cert-top">
              <p class="cert-line">
                <span>茲感謝</span>
                <span class="fill">${this.esc(data.payerName) || "　"}</span>
                <span>善信大德</span>
              </p>
              <p class="cert-line">
                <span>捐獻金額</span>
                <span class="amount">NT$ ${data.amount.toLocaleString()}</span>
                <span>元</span>
              </p>
              <p class="cert-line center">熱心公益　功德無量　特申謝忱　謹致此狀</p>
              ${seatNotesHtml}
            </div>
            <div class="cert-bottom">
              <div class="cert-signoff-row">
                <div class="cert-signoff">
                  <p>謹此銘謝</p>
                  <p>${this.esc(settings.committeeName ?? settings.templeName)}</p>
                  ${settings.address ? `<p>${this.esc(settings.address)}</p>` : ""}
                  ${settings.phone ? `<p>電話：${this.esc(settings.phone)}</p>` : ""}
                </div>
                <div class="cert-seals">
                  ${templeSealImg}
                  <span class="chairman-title">${this.esc(settings.chairmanTitle)}</span>
                  ${chairmanSealImg}
                </div>
              </div>
              <div class="cert-footer-lines">
                <p>日期:中華民國${year}年${month}月${day}日　經辦人：${this.esc(data.issuedByName)}</p>
              </div>
            </div>
          </div>
          <div class="cert-side">
            <div class="cert-side-content">
              <p class="temple-name">${this.esc(settings.templeName)}</p>
              ${settings.registrationNo ? `<p>立案證號：${this.esc(settings.registrationNo)}</p>` : ""}
              ${settings.taxId ? `<p>統一編號：${this.esc(settings.taxId)}</p>` : ""}
              ${itemsHtml}
              ${buildCopyLabel(copyLabel)}
            </div>
          </div>
        </div>
      </div>
    `;

    return this.wrapPrintPage(
      "收據",
      `<div class="certificate-page">${buildCopy("存根聯")}${buildCopy("收執聯")}</div>`,
      "A4",
      baseUrl,
    );
  }

  renderLanternLabelHtml(data: {
    wallName: string;
    slotCode: string;
    memberName: string;
    year: number;
    wishText: string;
    petitionText: string;
  }): string {
    return this.wrapPrintPage(
      "燈位標籤",
      `
      <div class="label">
        <div class="wall-name">${this.esc(data.wallName)}</div>
        <div class="slot-code">${this.esc(data.slotCode)}</div>
        <div class="member-name">${this.esc(data.memberName)}</div>
        <div class="year">${data.year} 年 平安燈</div>
        ${data.wishText ? `<div class="wish">${this.esc(data.wishText)}</div>` : ""}
        ${data.petitionText ? `<div class="petition">疏文：${this.esc(data.petitionText)}</div>` : ""}
      </div>
      `,
    );
  }

  private toRocDate(date: Date): { year: number; month: number; day: number } {
    return { year: date.getFullYear() - 1911, month: date.getMonth() + 1, day: date.getDate() };
  }

  private esc(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private wrapPrintPage(
    title: string,
    bodyHtml: string,
    pageSize: "80mm" | "A5" | "A4" = "80mm",
    baseUrl?: string,
  ): string {
    const pageRule =
      pageSize === "A5"
        ? "@page { size: A5; margin: 15mm; }"
        : pageSize === "A4"
          ? "@page { size: A4; margin: 8mm; }"
          : "@page { size: 80mm auto; margin: 4mm; }";
    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
${baseUrl ? `<base href="${this.esc(baseUrl)}" />` : ""}
<title>${title}</title>
<style>
  ${pageRule}
  body { font-family: "Microsoft JhengHei", "PMingLiU", sans-serif; margin: 0; padding: 0; }
  .receipt { width: 72mm; padding: 4mm; box-sizing: border-box; position: relative; }
  .receipt h1 { font-size: 16px; text-align: center; margin: 0 0 8px; }
  .receipt table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .receipt td { padding: 3px 2px; border-bottom: 1px dashed #999; vertical-align: top; }
  .receipt td:first-child { width: 30%; color: #555; }
  .footer { font-size: 11px; text-align: center; color: #666; margin-top: 8px; }
  .label { width: 60mm; padding: 4mm; text-align: center; box-sizing: border-box; }
  .label .wall-name { font-size: 12px; color: #555; }
  .label .slot-code { font-size: 22px; font-weight: bold; margin: 4px 0; }
  .label .member-name { font-size: 20px; font-weight: bold; margin: 4px 0; }
  .label .year { font-size: 12px; color: #555; }
  .label .wish { font-size: 12px; margin-top: 6px; border-top: 1px dashed #999; padding-top: 4px; }

  .certificate-page { height: 100vh; padding: 2mm 3mm; box-sizing: border-box; display: flex; flex-direction: column; }
  .cert-copy { position: relative; flex: 1 1 50%; min-height: 0; overflow: hidden; padding: 3mm 3mm; border-bottom: 1px dashed #999; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; }
  .cert-copy:last-child { border-bottom: none; }
  .cert-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
  .cert-title { font-size: 30px; letter-spacing: 6px; margin: 0; color: #1a2b4a; }
  .cert-no { font-size: 13px; color: #333; }
  .cert-body { position: relative; display: flex; flex: 1; min-height: 0; margin-right: 66px; }
  .cert-copy-label { position: absolute; right: -46px; top: 50%; transform: translateY(-50%); text-align: center; font-size: 15px; font-weight: bold; color: #a8071a; line-height: 1.7; }
  .cert-main { flex: 1; padding-right: 16px; display: flex; flex-direction: column; justify-content: space-between; }
  .cert-side { width: 150px; flex-shrink: 0; border-left: 1px solid #ccc; padding-left: 12px; font-size: 13px; color: #333; }
  .cert-side-content { position: relative; }
  .cert-side .temple-name { font-weight: bold; margin-bottom: 5px; }
  .cert-side p { margin: 5px 0; }
  .cert-items { margin-top: 8px; border-top: 1px dashed #999; padding-top: 6px; }
  .cert-items-title { font-weight: bold; margin: 0 0 5px; font-size: 13px; }
  .cert-item-line { margin: 4px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cert-item-amount { margin: 0 0 4px 8px; color: #a8071a; }
  .cert-line { font-size: 17px; margin: 8px 0; }
  .cert-line .fill { display: inline-block; min-width: 160px; border-bottom: 1px solid #999; text-align: center; margin: 0 8px; }
  .cert-line.center { text-align: center; letter-spacing: 2px; }
  .cert-line .amount { font-size: 23px; font-weight: bold; color: #a8071a; margin: 0 8px; }
  .cert-signoff-row { display: flex; align-items: center; gap: 12px; }
  .cert-signoff { flex: 1; min-width: 0; }
  .cert-signoff p { margin: 4px 0; font-size: 16px; }
  .cert-seals { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
  .cert-seals .seal-img.temple-seal { height: 74px; }
  .cert-seals .seal-img.chairman-seal { height: 52px; }
  .cert-seals .seal-placeholder.temple-seal { display: inline-block; width: 74px; height: 74px; }
  .cert-seals .seal-placeholder.chairman-seal { display: inline-block; width: 52px; height: 52px; }
  .cert-seat-note { font-size: 17px; font-weight: bold; color: #a8071a; margin: 4px 0 6px; }
  .chairman-title { font-size: 14px; }
  .cert-footer-lines p { margin: 6px 0; font-size: 14px; }
  .stamp { position: absolute; top: 15mm; left: 15mm; transform: rotate(-20deg); font-size: 32px; color: red; border: 3px solid red; padding: 2px 14px; opacity: 0.8; z-index: 10; }
</style>
</head>
<body onload="window.print()">
${bodyHtml}
</body>
</html>`;
  }
}
