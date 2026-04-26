package jp.pararia.teacherapp.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import jp.pararia.teacherapp.BuildConfig
import jp.pararia.teacherapp.MainActivity
import jp.pararia.teacherapp.R
import jp.pararia.teacherapp.data.TeacherApiClient
import jp.pararia.teacherapp.diagnostics.TeacherDiagnosticLevel
import jp.pararia.teacherapp.diagnostics.TeacherDiagnostics
import jp.pararia.teacherapp.domain.TeacherNotificationRepository
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val TEACHER_RECORDINGS_CHANNEL_ID = "teacher_recordings"
private const val OPEN_RECORDING_ACTION = "jp.pararia.teacherapp.OPEN_RECORDING"

private val notificationJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

object TeacherNotificationInitializer {
    fun initialize(context: Context) {
        createChannels(context)
        initializeFirebase(context)
    }

    private fun initializeFirebase(context: Context) {
        if (FirebaseApp.getApps(context).isNotEmpty()) return
        val appId = BuildConfig.PARARIA_FIREBASE_APPLICATION_ID.trim()
        val apiKey = BuildConfig.PARARIA_FIREBASE_API_KEY.trim()
        val projectId = BuildConfig.PARARIA_FIREBASE_PROJECT_ID.trim()
        val senderId = BuildConfig.PARARIA_FIREBASE_SENDER_ID.trim()
        if (listOf(appId, apiKey, projectId, senderId).any { it.isBlank() }) {
            TeacherDiagnostics.track(
                name = "push_firebase_not_configured",
                level = TeacherDiagnosticLevel.WARNING,
            )
            return
        }
        val options = FirebaseOptions.Builder()
            .setApplicationId(appId)
            .setApiKey(apiKey)
            .setProjectId(projectId)
            .setGcmSenderId(senderId)
            .build()
        FirebaseApp.initializeApp(context, options)
        TeacherDiagnostics.track("push_firebase_initialized")
    }

    private fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            TEACHER_RECORDINGS_CHANNEL_ID,
            "録音処理",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "録音の文字起こし完了と失敗を知らせます。"
        }
        manager.createNotificationChannel(channel)
    }
}

class DefaultTeacherNotificationRepository(
    private val context: Context,
    private val apiClient: TeacherApiClient,
) : TeacherNotificationRepository {
    override fun shouldRequestNotificationPermission(): Boolean {
        if (FirebaseApp.getApps(context).isEmpty()) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) != PackageManager.PERMISSION_GRANTED
    }

    override suspend fun syncPushToken() {
        if (FirebaseApp.getApps(context).isEmpty()) {
            TeacherDiagnostics.track(
                name = "push_token_sync_skipped",
                level = TeacherDiagnosticLevel.WARNING,
                details = mapOf("reason" to "firebase_not_configured"),
            )
            return
        }
        val token = FirebaseMessaging.getInstance().token.await()
        val permissionStatus = notificationPermissionStatus(context)
        apiClient.requestJson(
            path = "/api/teacher/native/notifications/register",
            deserializer = NotificationRegistrationResponse.serializer(),
            method = "POST",
            body = notificationJson.encodeToString(
                NotificationRegistrationRequest(
                    token = token,
                    permissionStatus = permissionStatus,
                )
            ),
        )
        TeacherDiagnostics.track(
            name = "push_token_sync_success",
            details = mapOf("permissionStatus" to permissionStatus),
        )
    }
}

class TeacherMessagingService : com.google.firebase.messaging.FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val app = application as? jp.pararia.teacherapp.TeacherApplication ?: return
        app.container.launchNotificationSync()
    }

    override fun onMessageReceived(message: com.google.firebase.messaging.RemoteMessage) {
        super.onMessageReceived(message)
        showTeacherRecordingNotification(
            context = this,
            title = message.notification?.title ?: defaultTitle(message.data["kind"]),
            body = message.notification?.body ?: defaultBody(message.data["kind"]),
            recordingId = message.data["recordingId"],
        )
    }
}

fun showTeacherRecordingNotification(
    context: Context,
    title: String,
    body: String,
    recordingId: String?,
) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    val intent = Intent(context, MainActivity::class.java).apply {
        action = OPEN_RECORDING_ACTION
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        if (!recordingId.isNullOrBlank()) {
            putExtra("recordingId", recordingId)
        }
    }
    val pendingIntent = PendingIntent.getActivity(
        context,
        (recordingId ?: "teacher-recording").hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(context, TEACHER_RECORDINGS_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_teacher_notification)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setContentIntent(pendingIntent)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()
    NotificationManagerCompat.from(context).notify(
        (recordingId ?: "teacher-recording-ready").hashCode(),
        notification,
    )
}

private fun notificationPermissionStatus(context: Context): String {
    return if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
        "granted"
    } else {
        "denied"
    }
}

private fun defaultTitle(kind: String?): String =
    if (kind == "teacher_recording_error") {
        "録音の文字起こしに失敗しました"
    } else {
        "録音の文字起こしが完了しました"
    }

private fun defaultBody(kind: String?): String =
    if (kind == "teacher_recording_error") {
        "アプリを開いて内容を確認してください。"
    } else {
        "アプリを開いて生徒を確認してください。"
    }

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnCompleteListener { task ->
        if (task.isSuccessful) {
            continuation.resume(task.result)
        } else {
            continuation.resumeWithException(task.exception ?: IllegalStateException("Firebase task failed"))
        }
    }
}

@Serializable
private data class NotificationRegistrationRequest(
    val provider: String = "FCM",
    val token: String,
    val permissionStatus: String,
)

@Serializable
private data class NotificationRegistrationResponse(
    val ok: Boolean,
)
