import { buildFigureArrays, type FigureDetail } from './figure';
import { decodeMember, type CrewMemberTransfer } from './member-transfer';

export interface FigureRequest { id: number; member: CrewMemberTransfer; detail: FigureDetail }

self.onmessage = (event: MessageEvent<FigureRequest>) => {
  const { id, member, detail } = event.data;
  const arrays = buildFigureArrays(decodeMember(member), detail);
  self.postMessage({ id, arrays }, { transfer: [arrays.position.buffer, arrays.normal.buffer, arrays.color.buffer, arrays.surface.buffer, arrays.index.buffer] });
};
