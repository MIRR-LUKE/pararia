package jp.pararia.teacherapp.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class TeacherClientPlatform {
    IOS,
    ANDROID,
    WEB,
    UNKNOWN,
}

@Serializable
data class TeacherClientInfo(
    val platform: TeacherClientPlatform,
    val appVersion: String? = null,
    val buildNumber: String? = null,
)

@Serializable
data class TeacherSession(
    val userId: String,
    val organizationId: String,
    val deviceId: String,
    val role: String,
    val roleLabel: String,
    val userName: String? = null,
    val userEmail: String? = null,
    val deviceLabel: String,
    val issuedAt: String,
    val expiresAt: String,
)

@Serializable
data class TeacherAuthBundle(
    val accessToken: String,
    val accessTokenExpiresAt: String,
    val refreshToken: String,
    val refreshTokenExpiresAt: String,
    val authSessionId: String,
    val tokenType: String,
)

@Serializable
data class TeacherNativeAuthResponse(
    val session: TeacherSession,
    val client: TeacherClientInfo,
    val auth: TeacherAuthBundle,
)

@Serializable
data class TeacherSessionEnvelope(
    val session: TeacherSession,
)

@Serializable
data class TeacherLogoutResponse(
    val ok: Boolean,
)

@Serializable
data class TeacherStudentCandidate(
    val id: String,
    val name: String,
    val subtitle: String? = null,
    val score: Double? = null,
    val reason: String? = null,
)

@Serializable
enum class TeacherRecordingStatus {
    @SerialName("RECORDING")
    RECORDING,

    @SerialName("TRANSCRIBING")
    TRANSCRIBING,

    @SerialName("AWAITING_STUDENT_CONFIRMATION")
    AWAITING_STUDENT_CONFIRMATION,

    @SerialName("STUDENT_CONFIRMED")
    STUDENT_CONFIRMED,

    @SerialName("CANCELLED")
    CANCELLED,

    @SerialName("ERROR")
    ERROR,
}

@Serializable
data class TeacherRecordingSummary(
    val id: String,
    val status: TeacherRecordingStatus,
    val deviceLabel: String,
    val recordedAt: String? = null,
    val uploadedAt: String? = null,
    val analyzedAt: String? = null,
    val confirmedAt: String? = null,
    val durationSeconds: Double? = null,
    val transcriptText: String? = null,
    val candidates: List<TeacherStudentCandidate> = emptyList(),
    val errorMessage: String? = null,
)

@Serializable
data class TeacherRecordingEnvelope(
    val recording: TeacherRecordingSummary? = null,
)

@Serializable
data class TeacherActiveRecordingEnvelope(
    val activeRecording: TeacherRecordingSummary? = null,
)

@Serializable
data class TeacherCreateRecordingResponse(
    val recordingId: String,
)

@Serializable
data class TeacherConfirmRecordingResponse(
    val ok: Boolean,
)

@Serializable
data class PendingUpload(
    val id: String,
    val recordingId: String,
    val filePath: String,
    val createdAt: String,
    val errorMessage: String? = null,
)

@Serializable
data class TeacherPersistentState(
    val authBundle: TeacherAuthBundle? = null,
    val pendingUploads: List<PendingUpload> = emptyList(),
)

data class DeviceLoginInput(
    val email: String,
    val password: String,
    val deviceLabel: String,
)

enum class RecorderPermissionStatus {
    UNDETERMINED,
    GRANTED,
    DENIED,
}

sealed interface TeacherRoute {
    data object Bootstrap : TeacherRoute
    data object Standby : TeacherRoute
    data class Recording(val seconds: Int) : TeacherRoute
    data class Analyzing(val recordingId: String, val message: String) : TeacherRoute
    data class Confirm(val summary: TeacherRecordingSummary) : TeacherRoute
    data class Done(val title: String, val message: String) : TeacherRoute
    data object Pending : TeacherRoute
}

data class TeacherUiState(
    val session: TeacherSession? = null,
    val route: TeacherRoute = TeacherRoute.Bootstrap,
    val pendingUploads: List<PendingUpload> = emptyList(),
    val errorMessage: String? = null,
    val requestMicrophonePermission: Boolean = false,
)

data class CompletedRecording(
    val filePath: String,
    val durationSeconds: Double,
)
