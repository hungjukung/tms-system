import { Fragment } from "react";
import {
  CeremonySeatDto,
  PILGRIMAGE_BUS_DOOR_ROWS,
  PILGRIMAGE_BUS_ROWS,
  PILGRIMAGE_BUS_SEATS_PER_ROW,
} from "@tms/shared";

const ROW_LABELS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

/** 進香座位文字：第幾排、由左到右第幾號，例如「3排2號」 */
export function busSeatLabel(seat: { tableNumber: number; seatInTable: number }): string {
  return `${seat.tableNumber}排${seat.seatInTable}號`;
}

const sideLabelStyle = { fontSize: 12, color: "#555", textAlign: "center" as const, alignSelf: "center" };

/**
 * 進香遊覽車座位圖：車頭在上，走道在中間，左右各 2 座；右側前門（1～2 排）、後門（7～8 排）沒有座位，
 * 左側 6、7 排之間標示安全門。粉紅色 = 已有人，藍色 = 本次選取，白色 = 空位。
 * 提供 onSeatClick 時空位可點選，否則僅供查看（例如活動詳情的座位表）。
 */
export function BusSeatMap({
  seats,
  chosenSeatIndexes,
  onSeatClick,
}: {
  seats: CeremonySeatDto[];
  chosenSeatIndexes?: number[];
  onSeatClick?: (seat: CeremonySeatDto) => void;
}) {
  const seatByIndex = new Map(seats.map((s) => [s.seatIndex, s]));
  const chosen = new Set(chosenSeatIndexes ?? []);

  const renderSeat = (row: number, col: number) => {
    const seat = seatByIndex.get((row - 1) * PILGRIMAGE_BUS_SEATS_PER_ROW + col);
    if (!seat) return <div key={`${row}-${col}`} />;
    const taken = seat.status === "TAKEN";
    const isChosen = chosen.has(seat.seatIndex);
    const clickable = !!onSeatClick && !taken;
    return (
      <div
        key={`${row}-${col}`}
        onClick={() => clickable && onSeatClick?.(seat)}
        title={`${busSeatLabel(seat)}${taken ? `：${seat.participantName || "已有人"}` : isChosen ? "（已選）" : "（空位）"}`}
        style={{
          height: 42,
          minWidth: 0,
          border: `1px solid ${isChosen ? "#1677ff" : "#8c8c8c"}`,
          borderRadius: 10,
          background: isChosen ? "#1677ff" : taken ? "#e8a0aa" : "#fff",
          color: isChosen ? "#fff" : "#333",
          cursor: clickable ? "pointer" : onSeatClick ? "not-allowed" : "default",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          lineHeight: 1.2,
          overflow: "hidden",
          padding: "0 2px",
          userSelect: "none",
        }}
      >
        <span>{col}號</span>
        {taken && seat.participantName && (
          <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {seat.participantName}
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto" }}>
      <div style={{ textAlign: "center", fontSize: 12, color: "#888", marginBottom: 4 }}>▲ 車頭</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "40px 1fr 1fr 26px 1fr 1fr 40px",
          gap: 6,
          border: "2px solid #4a90d9",
          borderRadius: 24,
          padding: 12,
        }}
      >
        {Array.from({ length: PILGRIMAGE_BUS_ROWS }, (_, i) => i + 1).map((row) => {
          const door = PILGRIMAGE_BUS_DOOR_ROWS[row];
          const firstDoorRow = door && !PILGRIMAGE_BUS_DOOR_ROWS[row - 1];
          return (
            <Fragment key={row}>
              {row === 7 && (
                <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 6, height: 18, background: "#1677ff" }} />
                  <span style={{ fontSize: 12, color: "#1677ff" }}>安全門</span>
                </div>
              )}
              <div style={sideLabelStyle}>{ROW_LABELS[row - 1]}排</div>
              {renderSeat(row, 1)}
              {renderSeat(row, 2)}
              <div style={{ ...sideLabelStyle, color: "#999" }}>{row === 5 ? "走" : row === 8 ? "道" : ""}</div>
              {door ? (
                firstDoorRow ? (
                  <div
                    style={{
                      gridColumn: "5 / span 3",
                      gridRow: "span 2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 8,
                      color: "#555",
                      fontSize: 13,
                    }}
                  >
                    {door}
                    <div style={{ width: 6, height: "80%", background: "#1677ff" }} />
                  </div>
                ) : null
              ) : (
                <>
                  {renderSeat(row, 3)}
                  {renderSeat(row, 4)}
                  <div style={sideLabelStyle}>{ROW_LABELS[row - 1]}排</div>
                </>
              )}
            </Fragment>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 8, fontSize: 12, flexWrap: "wrap" }}>
        <span>⬜ 空位</span>
        <span style={{ color: "#c0505f" }}>■ 已有人</span>
        {onSeatClick && <span style={{ color: "#1677ff" }}>■ 本次選取（再點一次取消）</span>}
      </div>
    </div>
  );
}
