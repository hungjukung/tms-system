import * as XLSX from "xlsx";
import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  TextRun,
} from "docx";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { ReceiptCertificateDataDto } from "@tms/shared";
import { getReceiptHtml } from "../api/print";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportRowsToExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

export async function exportRowsToWord(
  filename: string,
  title: string,
  headers: string[],
  rows: (string | number)[][],
  summaryLines: string[] = [],
) {
  const headerRow = new TableRow({
    children: headers.map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        }),
    ),
  });
  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map((cell) => new TableCell({ children: [new Paragraph(String(cell))] })),
      }),
  );

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
          ...summaryLines.map((line) => new Paragraph(line)),
          new Paragraph({ text: "" }),
          new Table({ rows: [headerRow, ...bodyRows] }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, filename);
}

/**
 * 匯出單筆資料（例如單張收據）為 PDF。html2canvas 會擷取瀏覽器實際渲染的畫面，
 * 所以借用一個暫時、畫面外的 DOM 節點來畫中文欄位，避免 jsPDF 內建字型不支援中文的問題。
 */
export async function exportSingleRecordToPdf(
  filename: string,
  title: string,
  fields: { label: string; value: string }[],
) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "400px";
  container.style.padding = "24px";
  container.style.background = "#ffffff";
  container.style.fontFamily = '"Microsoft JhengHei", "PMingLiU", sans-serif';

  const titleEl = document.createElement("h2");
  titleEl.textContent = title;
  titleEl.style.marginBottom = "16px";
  container.appendChild(titleEl);

  for (const field of fields) {
    const row = document.createElement("div");
    row.style.padding = "6px 0";
    row.style.borderBottom = "1px dashed #ccc";
    row.textContent = `${field.label}：${field.value}`;
    container.appendChild(row);
  }

  document.body.appendChild(container);
  try {
    await exportElementToPdf(container, filename);
  } finally {
    document.body.removeChild(container);
  }
}

function toRocDate(iso: string): { year: number; month: number; day: number } {
  const d = new Date(iso);
  return { year: d.getFullYear() - 1911, month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * 匯出單張收據的 PDF：直接擷取實際列印版面（感謝狀樣式，含印信圖片），
 * 而不是重新畫一份簡化表格，確保匯出內容跟列印出來的完全一致。
 */
export async function exportReceiptCertificatePdf(receiptId: string, filename: string) {
  const html = (await getReceiptHtml(receiptId)).replace(/onload="window\.print\(\)"/, "");

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "0";
  iframe.style.width = "900px";
  iframe.style.height = "1250px";
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = html;
    });
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("無法讀取列印內容");

    const images = Array.from(doc.images);
    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
      ),
    );

    await exportElementToPdf(doc.body, filename);
  } finally {
    document.body.removeChild(iframe);
  }
}

/** 匯出單張收據為 Word，內容與用詞比照感謝狀（茲感謝、捐獻金額、謹此銘謝...） */
export async function exportReceiptCertificateWord(data: ReceiptCertificateDataDto, filename: string) {
  const { year, month, day } = toRocDate(data.createdAt);
  const center = (text: string, opts: { bold?: boolean; size?: number } = {}) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: opts.bold, size: opts.size })],
    });

  const doc = new Document({
    sections: [
      {
        children: [
          center("感謝狀", { bold: true, size: 48 }),
          new Paragraph({ text: `NO：${data.receiptNo}`, alignment: AlignmentType.RIGHT }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: `茲感謝　${data.payerName || "　"}　善信大德` }),
          new Paragraph({
            children: [
              new TextRun("捐獻金額　"),
              new TextRun({ text: `NT$ ${data.amount.toLocaleString()}`, bold: true }),
              new TextRun("　元"),
            ],
          }),
          center("熱心公益　功德無量　特申謝忱　謹致此狀"),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "謹此銘謝" }),
          new Paragraph({ text: data.committeeName }),
          ...(data.address ? [new Paragraph({ text: data.address })] : []),
          ...(data.phone ? [new Paragraph({ text: `電話：${data.phone}` })] : []),
          new Paragraph({ text: "" }),
          new Paragraph({ text: data.chairmanTitle }),
          new Paragraph({ text: `經辦人：${data.issuedByName}` }),
          new Paragraph({ text: `日期：中華民國　${year}　年　${month}　月　${day}　日` }),
          new Paragraph({ text: "" }),
          new Paragraph({ children: [new TextRun({ text: data.templeName, bold: true })] }),
          ...(data.registrationNo ? [new Paragraph({ text: `立案證號：${data.registrationNo}` })] : []),
          ...(data.taxId ? [new Paragraph({ text: `統一編號：${data.taxId}` })] : []),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, filename);
}

/** 匯出單張收據為 Excel，欄位順序與用詞比照感謝狀內容 */
export function exportReceiptCertificateExcel(data: ReceiptCertificateDataDto, filename: string) {
  const { year, month, day } = toRocDate(data.createdAt);
  const rows: (string | number)[][] = [
    ["感謝狀編號", data.receiptNo],
    ["茲感謝", `${data.payerName || ""} 善信大德`],
    ["捐獻金額", data.amount],
    ["謹此銘謝", data.committeeName],
    ["地址", data.address ?? ""],
    ["電話", data.phone ?? ""],
    [data.chairmanTitle, ""],
    ["經辦人", data.issuedByName],
    ["日期（中華民國）", `${year} 年 ${month} 月 ${day} 日`],
    ["宮廟名稱", data.templeName],
    ["立案證號", data.registrationNo ?? ""],
    ["統一編號", data.taxId ?? ""],
  ];
  exportRowsToExcel(filename, "感謝狀", ["項目", "內容"], rows);
}

export async function exportElementToPdf(element: HTMLElement, filename: string) {
  const canvas = await html2canvas(element, { scale: 1.5, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/jpeg", 0.85);
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * usableWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imgData, "JPEG", margin, position, usableWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + margin;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  pdf.save(filename);
}
