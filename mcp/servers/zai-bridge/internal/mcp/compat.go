package mcp

import (
	"context"
	"encoding/json"
)

func (d Deps) listAccounts(raw json.RawMessage) (any, *RPCError) {
	return d.listAccountsContext(context.Background(), raw)
}
func (d Deps) listChats(raw json.RawMessage) (any, *RPCError) {
	return d.listChatsContext(context.Background(), raw)
}
func (d Deps) listTags(raw json.RawMessage) (any, *RPCError) {
	return d.listTagsContext(context.Background(), raw)
}
func (d Deps) listModels(raw json.RawMessage) (any, *RPCError) {
	return d.listModelsContext(context.Background(), raw)
}
func (d Deps) renameChat(raw json.RawMessage) (any, *RPCError) {
	return d.renameChatContext(context.Background(), raw)
}
func (d Deps) pinChat(raw json.RawMessage) (any, *RPCError) {
	return d.pinChatContext(context.Background(), raw)
}
func (d Deps) archiveChat(raw json.RawMessage) (any, *RPCError) {
	return d.archiveChatContext(context.Background(), raw)
}
func (d Deps) deleteChat(raw json.RawMessage) (any, *RPCError) {
	return d.deleteChatContext(context.Background(), raw)
}
func (d Deps) getChat(raw json.RawMessage) (any, *RPCError) {
	return d.getChatContext(context.Background(), raw)
}
func (d Deps) getMessages(raw json.RawMessage) (any, *RPCError) {
	return d.getMessagesContext(context.Background(), raw)
}
func (d Deps) createChat(raw json.RawMessage) (any, *RPCError) {
	return d.createChatContext(context.Background(), raw)
}
func (d Deps) sendMessage(raw json.RawMessage) (any, *RPCError) {
	return d.sendMessageContext(context.Background(), raw)
}
func (d Deps) waitForReply(raw json.RawMessage) (any, *RPCError) {
	return d.waitForReplyContext(context.Background(), raw)
}
func (d Deps) getUsage(raw json.RawMessage) (any, *RPCError) {
	return d.getUsageContext(context.Background(), raw)
}
func (d Deps) listFiles(raw json.RawMessage) (any, *RPCError) {
	return d.listFilesContext(context.Background(), raw)
}
func (d Deps) downloadFile(raw json.RawMessage) (any, *RPCError) {
	return d.downloadFileContext(context.Background(), raw)
}
func (d Deps) uploadFile(raw json.RawMessage) (any, *RPCError) {
	return d.uploadFileContext(context.Background(), raw)
}
func (d Deps) deleteFile(raw json.RawMessage) (any, *RPCError) {
	return d.deleteFileContext(context.Background(), raw)
}
func (d Deps) listChatFiles(raw json.RawMessage) (any, *RPCError) {
	return d.listChatFilesContext(context.Background(), raw)
}
func (d Deps) downloadChatFile(raw json.RawMessage) (any, *RPCError) {
	return d.downloadChatFileContext(context.Background(), raw)
}
