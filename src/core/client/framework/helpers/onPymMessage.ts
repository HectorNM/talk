import { Child, MessageCallback } from "pym.js";

function onPymMessage(
  child: Child,
  messageType: string,
  callback: MessageCallback
) {
  child.onMessage(messageType, callback);
  return () => {
    if (!(messageType in child.messageHandlers)) {
      // eslint-disable-next-line no-console
      console.warn("Pym message handler already disposed.");
      return;
    }
    const index = child.messageHandlers[messageType].indexOf(callback);
    if (index === -1) {
      // eslint-disable-next-line no-console
      console.warn("Pym message handler already disposed.");
      return;
    }
    child.messageHandlers[messageType].splice(index, 1);
    if (child.messageHandlers[messageType].length === 0) {
      delete child.messageHandlers[messageType];
    }
  };
}

export default onPymMessage;
