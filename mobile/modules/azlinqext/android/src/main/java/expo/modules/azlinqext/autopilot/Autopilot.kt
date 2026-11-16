package expo.modules.azlinqext.autopilot

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import expo.modules.azlinqext.ai.ApiClient
import expo.modules.azlinqext.ai.ApiFailure
import expo.modules.azlinqext.ai.ReplyRequest
import expo.modules.azlinqext.store.KeyboardStore
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Chat and SMS apps AZLinqext may read notifications from. Matching is exact on the package name. Banking, email and
 * every other app are never read.
 */
object AutopilotApps {
    val labels: Map<String, String> = linkedMapOf(
        "com.whatsapp" to "WhatsApp", "com.whatsapp.w4b" to "WhatsApp Business", "org.telegram.messenger" to "Telegram", "org.telegram.messenger.web" to "Telegram",
        "org.thoughtcrime.securesms" to "Signal", "com.google.android.apps.messaging" to "Google Messages", "com.samsung.android.messaging" to "Samsung Messages", "com.android.mms" to "Messages",
    )
    val packages: Set<String> get() = labels.keys
}

/** A reply waiting for the user's review. Held in memory only; if the app process ends, the draft expires. */
class PendingDraft(val id: Int, val action: Notification.Action?, val sender: String, val message: String, val reply: String, val packageName: String, val appLabel: String, val warning: String)

object Notifier {
    const val DRAFTS = "azlinqext_autopilot_drafts"
    const val CHECKINS = "azlinqext_autopilot_checkins"
    private val nextId = AtomicInteger(9000)
    private val drafts = LinkedHashMap<Int, PendingDraft>()

    private fun manager(ctx: Context) = ctx.getSystemService(NotificationManager::class.java)

    private fun channels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val m = manager(ctx)
        m.createNotificationChannel(NotificationChannel(DRAFTS, "AZLinqext drafts", NotificationManager.IMPORTANCE_HIGH).apply { description = "Drafts for you to review"; lockscreenVisibility = Notification.VISIBILITY_PRIVATE })
        m.createNotificationChannel(NotificationChannel(CHECKINS, "AZLinqext check-ins", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "A reminder when drafts or messages are waiting"; lockscreenVisibility = Notification.VISIBILITY_PRIVATE })
    }

    private fun builder(ctx: Context, channel: String) = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, channel) else @Suppress("DEPRECATION") Notification.Builder(ctx)

    /** The lock screen shows only this generic version; the details appear after the phone is unlocked. */
    private fun generic(ctx: Context, channel: String, title: String): Notification =
        builder(ctx, channel).setSmallIcon(android.R.drawable.ic_dialog_email).setContentTitle(title).build()

    private fun dismissIntent(ctx: Context, id: Int): PendingIntent =
        PendingIntent.getBroadcast(ctx, id, Intent(ctx, AutopilotReceiver::class.java).setAction("dismiss").putExtra("id", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** Opens the in-app review screen for this draft (azee://review?id=…). */
    private fun reviewIntent(ctx: Context, id: Int): PendingIntent =
        PendingIntent.getActivity(ctx, id, Intent(Intent.ACTION_VIEW, Uri.parse("azee://review?id=$id")).setPackage(ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun postDraft(ctx: Context, d: PendingDraft) {
        channels(ctx)
        synchronized(drafts) { drafts[d.id] = d; while (drafts.size > 30) drafts.remove(drafts.keys.first()) }
        val b = builder(ctx, DRAFTS).setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("Review draft for ${d.sender}").setContentText("${d.appLabel} · tap to review before sending")
            .setAutoCancel(true).setContentIntent(reviewIntent(ctx, d.id)).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(generic(ctx, DRAFTS, "You have a draft to review"))
        b.addAction(Notification.Action.Builder(null, "Review", reviewIntent(ctx, d.id)).build())
        b.addAction(Notification.Action.Builder(null, "Dismiss", dismissIntent(ctx, d.id)).build())
        manager(ctx).notify(d.id, b.build())
    }

    fun newId() = nextId.incrementAndGet()
    fun peek(id: Int): PendingDraft? = synchronized(drafts) { drafts[id] }
    fun take(id: Int): PendingDraft? = synchronized(drafts) { drafts.remove(id) }
    fun cancel(ctx: Context, id: Int) = manager(ctx).cancel(id)

    fun postCheckIn(ctx: Context, title: String, text: String) {
        channels(ctx)
        manager(ctx).notify(nextId.incrementAndGet(), builder(ctx, CHECKINS).setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title).setContentText(text.lineSequence().first()).setStyle(Notification.BigTextStyle().bigText(text)).setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(generic(ctx, CHECKINS, "You have drafts to review")).build())
    }

    /**
     * Hands [text] to the chat app's own notification reply box, as if the user typed it there. This is only ever called from
     * [reviewSend], which runs when the user taps Send on the review screen.
     */
    private fun handOver(ctx: Context, action: Notification.Action, text: String): Boolean {
        val inputs = action.remoteInputs ?: return false
        val intent = Intent()
        val results = Bundle().also { b -> inputs.forEach { b.putCharSequence(it.resultKey, text) } }
        RemoteInput.addResultsToIntent(inputs, intent, results)
        return try { action.actionIntent.send(ctx, 0, intent); true } catch (_: PendingIntent.CanceledException) { false }
    }

    /** The user's explicit Send on the review screen. Returns false if the chat's reply action is no longer available. */
    fun reviewSend(ctx: Context, id: Int, text: String): Boolean {
        val draft = peek(id) ?: return false
        val action = draft.action ?: return false
        val body = text.trim()
        if (body.isEmpty()) return false
        if (!handOver(ctx, action, body)) return false
        take(id); cancel(ctx, id)
        AutopilotStore.get(ctx).log("handed", draft.sender, "Reply handed to ${draft.appLabel}")
        return true
    }

    /** Forgets every pending draft and removes their notifications (used when the user switches Autopilot off). */
    fun clearAll(ctx: Context) {
        val ids = synchronized(drafts) { drafts.keys.toList().also { drafts.clear() } }
        ids.forEach { cancel(ctx, it) }
    }

    fun reviewDismiss(ctx: Context, id: Int) {
        val draft = take(id)
        cancel(ctx, id)
        if (draft != null) AutopilotStore.get(ctx).log("dismissed", draft.sender, "You dismissed the draft")
    }
}

/** Reads message notifications from supported chat apps and writes a draft for review, according to the user's chosen mode. */
class AzNotificationListener : NotificationListenerService() {
    private val pool = Executors.newSingleThreadExecutor()
    private val seen = LinkedHashSet<String>()

    override fun onListenerConnected() { connected = true; Scheduler.apply(this, AutopilotStore.get(this).load().digestMinutes) }
    override fun onListenerDisconnected() { connected = false }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try { handle(sbn) } catch (_: Throwable) { /* a malformed notification must never crash the listener */ }
    }

    private fun handle(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName || sbn.packageName !in AutopilotApps.packages) return
        val store = AutopilotStore.get(this)
        val settings = store.load()
        if (settings.mode == AutopilotMode.OFF || settings.paused) return
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0 || n.category == Notification.CATEGORY_CALL || n.category == Notification.CATEGORY_PROGRESS) return
        val msg = parse(n.extras) ?: return
        val now = System.currentTimeMillis()
        if (msg.timeMs > 0 && now - msg.timeMs > 10 * 60_000L) return                     // an old notification being re-posted
        val key = "${sbn.key}|${msg.timeMs}|${msg.text.hashCode()}"
        synchronized(seen) { if (!seen.add(key)) return; if (seen.size > 300) seen.remove(seen.first()) }
        if (AutopilotPolicy.decide(settings, Incoming(msg.sender, msg.text, msg.isGroup)) is Decision.Ignore) return
        RecentInbox.add(msg.sender, msg.text, now)
        val action = n.actions?.firstOrNull { a -> a.remoteInputs?.any { it.allowFreeFormInput } == true }
        val pkg = sbn.packageName
        pool.execute { try { process(msg, action, pkg) } catch (_: Throwable) { } }
    }

    private fun process(msg: Parsed, action: Notification.Action?, packageName: String) {
        val store = AutopilotStore.get(this)
        val decision = AutopilotPolicy.decide(store.load(), Incoming(msg.sender, msg.text, msg.isGroup))
        if (decision !is Decision.Draft) { return }
        val reply = try {
            ApiClient(KeyboardStore.forContext(this)).reply(ReplyRequest(UUID.randomUUID().toString(), msg.text.take(AutopilotPolicy.MAX_MESSAGE_CHARS), decision.tone, 1)).replies.firstOrNull()
        } catch (e: ApiFailure) { store.log("error", msg.sender, e.message ?: "Could not write a draft"); return } catch (_: Exception) { store.log("error", msg.sender, "Could not write a draft"); return }
        if (reply.isNullOrBlank()) return
        val current = store.load()                                                           // the user may have paused or switched it off meanwhile
        if (current.mode == AutopilotMode.OFF || current.paused) return
        val warning = if (AutopilotPolicy.draftAddsNoDetails(msg.text, reply)) "" else "This draft mentions details that were not in their message. Check them before sending."
        val label = AutopilotApps.labels[packageName] ?: "the chat app"
        store.log("drafted", msg.sender, "Draft ready · $label")
        Notifier.postDraft(this, PendingDraft(Notifier.newId(), action, msg.sender, msg.text, reply, packageName, label, warning))
    }

    data class Parsed(val sender: String, val text: String, val timeMs: Long, val isGroup: Boolean)

    @Suppress("DEPRECATION")
    private fun parse(e: Bundle): Parsed? {
        val title = e.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val group = e.getBoolean("android.isGroupConversation", false)
        val last = e.getParcelableArray("android.messages")?.lastOrNull() as? Bundle
        val text = (last?.getCharSequence("text") ?: e.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim().orEmpty()
        val who = last?.getCharSequence("sender")?.toString()?.trim().orEmpty()
        if (text.isEmpty() || title.isEmpty()) return null
        if (who.equals("you", true) || who.equals("me", true)) return null                   // the last line is the user's own
        return Parsed(title, text, last?.getLong("time") ?: 0L, group)
    }

    companion object { @Volatile var connected = false }
}

/** Handles Dismiss on a draft notification, and the scheduled reminder. */
class AutopilotReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            "dismiss" -> Notifier.reviewDismiss(ctx, intent.getIntExtra("id", 0))
            "digest" -> remind(ctx, AutopilotStore.get(ctx))
        }
    }

    /** A reminder only when there is something to review. It never contains message text on the lock screen. */
    private fun remind(ctx: Context, store: AutopilotStore) {
        val s = store.load()
        if (s.mode == AutopilotMode.OFF || s.paused || s.digestMinutes == 0) return
        val now = System.currentTimeMillis()
        val since = store.lastDigestMs.takeIf { it > 0 } ?: (now - s.digestMinutes * 60_000L)
        val msgs = RecentInbox.since(since)
        val log = store.readLog()
        val drafts = (0 until log.length()).count { log.getJSONObject(it).let { e -> e.optLong("t") >= since && e.optString("action") == "drafted" } }
        store.lastDigestMs = now
        if (msgs.isEmpty() && drafts == 0) return
        Notifier.postCheckIn(ctx, "AZLinqext check-in", "${msgs.size} new message${if (msgs.size == 1) "" else "s"} · $drafts draft${if (drafts == 1) "" else "s"} to review\n" + RecentInbox.digest(msgs))
    }
}

/** The check-in reminder. Inexact on purpose: Android may shift it a little to save battery. */
object Scheduler {
    fun apply(ctx: Context, minutes: Int) {
        val alarms = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pending = PendingIntent.getBroadcast(ctx, 7001, Intent(ctx, AutopilotReceiver::class.java).setAction("digest"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        alarms.cancel(pending)
        if (minutes <= 0) return
        val every = minutes * 60_000L
        alarms.setInexactRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + every, every, pending)
    }
}
