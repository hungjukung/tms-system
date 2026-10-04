import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server } from "socket.io";
import { SlotClaimedEvent } from "@tms/shared";

@WebSocketGateway({ cors: { origin: "*" }, namespace: "/lantern" })
export class LanternGateway {
  @WebSocketServer()
  server: Server;

  broadcastSlotClaimed(event: SlotClaimedEvent) {
    this.server.emit("slot.claimed", event);
  }
}
