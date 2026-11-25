import { Q as WebPlugin, a as onMessage, i as isWindowSupported, n as getMessagingInWindow, r as getToken, t as deleteToken } from "./index-D_VWUDnR.js";
// node_modules/@capacitor-firebase/messaging/dist/esm/web.js
var FirebaseMessagingWeb = class FirebaseMessagingWeb extends WebPlugin {
	constructor() {
		super();
		isWindowSupported().then((supported) => {
			if (!supported) return;
			const messaging = getMessagingInWindow();
			onMessage(messaging, (payload) => this.handleNotificationReceived(payload));
		});
	}
	async checkPermissions() {
		if (!await isWindowSupported()) return { receive: "denied" };
		return { receive: this.convertNotificationPermissionToPermissionState(Notification.permission) };
	}
	async requestPermissions() {
		if (!await isWindowSupported()) return { receive: "denied" };
		const notificationPermission = await Notification.requestPermission();
		return { receive: this.convertNotificationPermissionToPermissionState(notificationPermission) };
	}
	async isSupported() {
		return { isSupported: await isWindowSupported() };
	}
	async getToken(options) {
		const messaging = getMessagingInWindow();
		return { token: await getToken(messaging, {
			vapidKey: options.vapidKey,
			serviceWorkerRegistration: options.serviceWorkerRegistration
		}) };
	}
	async deleteToken() {
		const messaging = getMessagingInWindow();
		await deleteToken(messaging);
	}
	async getDeliveredNotifications() {
		this.throwUnimplementedError();
	}
	async removeDeliveredNotifications(_options) {
		this.throwUnimplementedError();
	}
	async removeAllDeliveredNotifications() {
		this.throwUnimplementedError();
	}
	async subscribeToTopic(_options) {
		this.throwUnimplementedError();
	}
	async unsubscribeFromTopic(_options) {
		this.throwUnimplementedError();
	}
	async createChannel(_options) {
		this.throwUnimplementedError();
	}
	async deleteChannel(_options) {
		this.throwUnimplementedError();
	}
	async listChannels() {
		this.throwUnimplementedError();
	}
	handleNotificationReceived(messagePayload) {
		const event = { notification: this.createNotificationResult(messagePayload) };
		this.notifyListeners(FirebaseMessagingWeb.notificationReceivedEvent, event);
	}
	createNotificationResult(messagePayload) {
		var _a, _b, _c;
		return {
			body: (_a = messagePayload.notification) === null || _a === void 0 ? void 0 : _a.body,
			data: messagePayload.data,
			id: messagePayload.messageId,
			image: (_b = messagePayload.notification) === null || _b === void 0 ? void 0 : _b.image,
			title: (_c = messagePayload.notification) === null || _c === void 0 ? void 0 : _c.title
		};
	}
	convertNotificationPermissionToPermissionState(permission) {
		let state = "prompt";
		switch (permission) {
			case "granted":
				state = "granted";
				break;
			case "denied": state = "denied";
		}
		return state;
	}
	throwUnimplementedError() {
		throw this.unimplemented("Not implemented on web.");
	}
};
FirebaseMessagingWeb.notificationReceivedEvent = "notificationReceived";
export { FirebaseMessagingWeb };
