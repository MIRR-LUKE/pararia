package jp.pararia.teacherapp.data

import jp.pararia.teacherapp.BuildConfig
import jp.pararia.teacherapp.domain.DeviceLoginInput
import jp.pararia.teacherapp.domain.PendingUpload
import jp.pararia.teacherapp.domain.PendingUploadStore
import jp.pararia.teacherapp.domain.TeacherAuthRepository
import jp.pararia.teacherapp.domain.TeacherClientInfo
import jp.pararia.teacherapp.domain.TeacherClientPlatform
import jp.pararia.teacherapp.domain.TeacherCreateRecordingResponse
import jp.pararia.teacherapp.domain.TeacherAuthBundle
import jp.pararia.teacherapp.domain.TeacherNativeAuthResponse
import jp.pararia.teacherapp.domain.TeacherRecordingEnvelope
import jp.pararia.teacherapp.domain.TeacherRecordingRepository
import jp.pararia.teacherapp.domain.TeacherRecordingSummary
import jp.pararia.teacherapp.domain.TeacherRecordingStatus
import jp.pararia.teacherapp.domain.TeacherSession
import jp.pararia.teacherapp.domain.TeacherSessionEnvelope
import jp.pararia.teacherapp.domain.TeacherTokenStore
import jp.pararia.teacherapp.domain.TeacherActiveRecordingEnvelope
import jp.pararia.teacherapp.domain.TeacherConfirmRecordingResponse
import jp.pararia.teacherapp.domain.TeacherLogoutResponse
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID

private val repositoryJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

private fun currentClientInfo(): TeacherClientInfo =
    TeacherClientInfo(
        platform = TeacherClientPlatform.ANDROID,
        appVersion = BuildConfig.VERSION_NAME,
        buildNumber = BuildConfig.VERSION_CODE.toString(),
    )

@Serializable
private data class DeviceLoginRequest(
    val email: String,
    val password: String,
    val deviceLabel: String,
    val client: TeacherClientInfo,
)

@Serializable
private data class RefreshRequest(
    val refreshToken: String,
    val client: TeacherClientInfo,
)

@Serializable
private data class ConfirmStudentRequest(
    val studentId: String?,
)

class DefaultTeacherAuthRepository(
    private val apiClient: TeacherApiClient,
    private val tokenStore: TeacherTokenStore,
) : TeacherAuthRepository {
    private val lock = Mutex()
    private var cachedSession: TeacherSession? = null

    override suspend fun currentSession(): TeacherSession? {
        cachedSession?.let { return it }
        return runCatching { refreshIfNeeded() }.getOrNull()
    }

    override suspend fun login(input: DeviceLoginInput): TeacherSession = lock.withLock {
        val request = DeviceLoginRequest(
            email = input.email,
            password = input.password,
            deviceLabel = input.deviceLabel,
            client = currentClientInfo(),
        )
        val response: TeacherNativeAuthResponse = apiClient.requestJson(
            path = "/api/teacher/native/auth/device-login",
            deserializer = TeacherNativeAuthResponse.serializer(),
            method = "POST",
            body = repositoryJson.encodeToString(request),
            requiresAuth = false,
        )
        tokenStore.saveAuthBundle(response.auth)
        cachedSession = response.session
        response.session
    }

    override suspend fun refreshIfNeeded(): TeacherSession? = lock.withLock {
        val bundle = tokenStore.loadAuthBundle() ?: return null
        val expiresSoon = runCatching {
            Instant.parse(bundle.accessTokenExpiresAt).isBefore(Instant.now().plusSeconds(30))
        }.getOrDefault(true)

        val session = if (expiresSoon) {
            refreshAuthBundle(bundle).session
        } else {
            val response: TeacherSessionEnvelope = apiClient.requestJson(
                path = "/api/teacher/native/auth/session",
                deserializer = TeacherSessionEnvelope.serializer(),
            )
            response.session
        }
        cachedSession = session
        session
    }

    override suspend fun logout() {
        runCatching {
            val _: TeacherLogoutResponse = apiClient.requestJson(
                path = "/api/teacher/native/auth/logout",
                deserializer = TeacherLogoutResponse.serializer(),
                method = "POST",
            )
        }
        tokenStore.clearAuthBundle()
        cachedSession = null
    }

    private suspend fun refreshAuthBundle(bundle: TeacherAuthBundle): TeacherNativeAuthResponse {
        val request = RefreshRequest(
            refreshToken = bundle.refreshToken,
            client = currentClientInfo(),
        )
        val response: TeacherNativeAuthResponse = apiClient.requestJson(
            path = "/api/teacher/native/auth/refresh",
            deserializer = TeacherNativeAuthResponse.serializer(),
            method = "POST",
            body = repositoryJson.encodeToString(request),
            requiresAuth = false,
        )
        tokenStore.saveAuthBundle(response.auth)
        return response
    }
}

class DefaultTeacherRecordingRepository(
    private val apiClient: TeacherApiClient,
    private val authRepository: TeacherAuthRepository,
    private val pendingUploadStore: PendingUploadStore,
) : TeacherRecordingRepository {
    override suspend fun loadActiveRecording(): TeacherRecordingSummary? {
        val response: TeacherActiveRecordingEnvelope = withAuthenticatedRequest {
            apiClient.requestJson(
                path = "/api/teacher/recordings",
                deserializer = TeacherActiveRecordingEnvelope.serializer(),
            )
        }
        return response.activeRecording
    }

    override suspend fun createRecording(): String {
        val response: TeacherCreateRecordingResponse = withAuthenticatedRequest {
            apiClient.requestJson(
                path = "/api/teacher/recordings",
                deserializer = TeacherCreateRecordingResponse.serializer(),
                method = "POST",
            )
        }
        return response.recordingId
    }

    override suspend fun uploadAudio(
        recordingId: String,
        filePath: String,
        durationSeconds: Double?,
    ): TeacherRecordingSummary? {
        return try {
            withAuthenticatedRequest {
                apiClient.uploadAudio(
                    recordingId = recordingId,
                    filePath = filePath,
                    durationSeconds = durationSeconds,
                ).recording
            }
        } catch (error: Exception) {
            pendingUploadStore.save(
                PendingUpload(
                    id = UUID.randomUUID().toString(),
                    recordingId = recordingId,
                    filePath = filePath,
                    createdAt = Instant.now().toString(),
                    errorMessage = error.message,
                )
            )
            throw error
        }
    }

    override suspend fun pollRecording(recordingId: String): TeacherRecordingSummary {
        val deadline = Instant.now().plusSeconds(120)
        while (Instant.now().isBefore(deadline)) {
            val envelope: TeacherRecordingEnvelope = withAuthenticatedRequest {
                apiClient.requestJson(
                    path = "/api/teacher/recordings/$recordingId/progress",
                    deserializer = TeacherRecordingEnvelope.serializer(),
                )
            }
            val summary = envelope.recording
                ?: throw TeacherApiException(404, "録音セッションが見つかりません。")
            if (summary.status != TeacherRecordingStatus.TRANSCRIBING &&
                summary.status != TeacherRecordingStatus.RECORDING
            ) {
                return summary
            }
            delay(1_500)
        }
        throw TeacherApiException(408, "処理に時間がかかっています。")
    }

    override suspend fun confirmStudent(recordingId: String, studentId: String?) {
        val body = repositoryJson.encodeToString(ConfirmStudentRequest(studentId))
        val _: TeacherConfirmRecordingResponse = withAuthenticatedRequest {
            apiClient.requestJson(
                path = "/api/teacher/recordings/$recordingId/confirm",
                deserializer = TeacherConfirmRecordingResponse.serializer(),
                method = "POST",
                body = body,
            )
        }
    }

    override suspend fun cancelRecording(recordingId: String) {
        val _: TeacherLogoutResponse = withAuthenticatedRequest {
            apiClient.requestJson(
                path = "/api/teacher/recordings/$recordingId/cancel",
                deserializer = TeacherLogoutResponse.serializer(),
                method = "POST",
            )
        }
    }

    override suspend fun retryPendingUploads() {
        pendingUploadStore.loadItems().forEach { item ->
            uploadAudio(
                recordingId = item.recordingId,
                filePath = item.filePath,
                durationSeconds = null,
            )
            pendingUploadStore.remove(item.id)
        }
    }

    private suspend fun <T> withAuthenticatedRequest(block: suspend () -> T): T {
        authRepository.refreshIfNeeded()
        return try {
            block()
        } catch (error: TeacherApiException) {
            if (error.statusCode == 401) {
                authRepository.refreshIfNeeded()
                block()
            } else {
                throw error
            }
        }
    }
}
