package jp.pararia.teacherapp.data

import jp.pararia.teacherapp.BuildConfig
import jp.pararia.teacherapp.diagnostics.TeacherDiagnosticLevel
import jp.pararia.teacherapp.diagnostics.TeacherDiagnostics
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
import jp.pararia.teacherapp.domain.TeacherStudentCandidate
import jp.pararia.teacherapp.domain.TeacherStudentSearchEnvelope
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
import java.io.File
import java.time.Instant
import java.util.UUID

private val repositoryJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

private const val TEACHER_RECORDING_POLL_TIMEOUT_MS = 45 * 60 * 1000L
private const val TEACHER_RECORDING_POLL_FAST_MS = 1_500L
private const val TEACHER_RECORDING_POLL_WARM_MS = 2_500L
private const val TEACHER_RECORDING_POLL_SLOW_MS = 4_000L
private const val TEACHER_RECORDING_DIRECT_BLOB_THRESHOLD_BYTES = 4L * 1024L * 1024L

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
        TeacherDiagnostics.track("session_restore_start")
        return runCatching { fetchCurrentSession() }.getOrNull()
            .also { session ->
                TeacherDiagnostics.track(
                    name = if (session == null) "session_restore_empty" else "session_restore_success",
                    deviceLabel = session?.deviceLabel,
                )
            }
    }

    override suspend fun login(input: DeviceLoginInput): TeacherSession = lock.withLock {
        TeacherDiagnostics.track(
            name = "login_request",
            deviceLabel = input.deviceLabel,
        )
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
        TeacherDiagnostics.track(
            name = "login_success",
            deviceLabel = response.session.deviceLabel,
        )
        response.session
    }

    override suspend fun refreshIfNeeded(): TeacherSession? = refresh(forceRefresh = false)

    override suspend fun forceRefresh(): TeacherSession? = refresh(forceRefresh = true)

    private suspend fun refresh(forceRefresh: Boolean): TeacherSession? = lock.withLock {
        val bundle = tokenStore.loadAuthBundle() ?: return null
        if (!forceRefresh && !accessTokenExpiresSoon(bundle)) {
            return cachedSession
        }

        TeacherDiagnostics.track(
            name = if (forceRefresh) "refresh_force_start" else "refresh_start",
        )
        val session = refreshAuthBundle(bundle).session
        cachedSession = session
        TeacherDiagnostics.track(
            name = if (forceRefresh) "refresh_force_success" else "refresh_success",
            deviceLabel = session.deviceLabel,
        )
        return session
    }

    override suspend fun logout() {
        TeacherDiagnostics.track(
            name = "logout_start",
            deviceLabel = cachedSession?.deviceLabel,
        )
        runCatching {
            apiClient.requestJson(
                path = "/api/teacher/native/auth/logout",
                deserializer = TeacherLogoutResponse.serializer(),
                method = "POST",
            )
        }
        tokenStore.clearAuthBundle()
        cachedSession = null
        TeacherDiagnostics.track("logout_success")
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

    private suspend fun fetchCurrentSession(): TeacherSession? = lock.withLock {
        cachedSession?.let { return it }
        val bundle = tokenStore.loadAuthBundle() ?: return null
        if (accessTokenExpiresSoon(bundle)) {
            val session = refreshAuthBundle(bundle).session
            cachedSession = session
            return session
        }

        val response: TeacherSessionEnvelope = apiClient.requestJson(
            path = "/api/teacher/native/auth/session",
            deserializer = TeacherSessionEnvelope.serializer(),
        )
        cachedSession = response.session
        return response.session
    }

    private fun accessTokenExpiresSoon(bundle: TeacherAuthBundle): Boolean = runCatching {
        Instant.parse(bundle.accessTokenExpiresAt).isBefore(Instant.now().plusSeconds(30))
    }.getOrDefault(true)
}

class DefaultTeacherRecordingRepository(
    private val apiClient: TeacherApiClient,
    private val authRepository: TeacherAuthRepository,
    private val pendingUploadStore: PendingUploadStore,
) : TeacherRecordingRepository {
    override suspend fun loadActiveRecording(): TeacherRecordingSummary? {
        TeacherDiagnostics.track("active_recording_load_start")
        val response: TeacherActiveRecordingEnvelope = withAuthenticatedRequest {
            apiClient.requestJson(
                path = "/api/teacher/recordings",
                deserializer = TeacherActiveRecordingEnvelope.serializer(),
            )
        }
        TeacherDiagnostics.track(
            name = "active_recording_load_result",
            recordingId = response.activeRecording?.id,
            deviceLabel = response.activeRecording?.deviceLabel,
            details = mapOf("status" to response.activeRecording?.status?.name),
        )
        return response.activeRecording
    }

    override suspend fun loadRecording(recordingId: String): TeacherRecordingSummary? {
        TeacherDiagnostics.track(
            name = "recording_load_start",
            recordingId = recordingId,
        )
        val response: TeacherRecordingEnvelope = withAuthenticatedRequest {
            apiClient.requestJson(
                path = "/api/teacher/recordings/$recordingId/progress",
                deserializer = TeacherRecordingEnvelope.serializer(),
            )
        }
        TeacherDiagnostics.track(
            name = "recording_load_result",
            recordingId = recordingId,
            deviceLabel = response.recording?.deviceLabel,
            details = mapOf("status" to response.recording?.status?.name),
        )
        return response.recording
    }

    override suspend fun searchStudents(query: String): List<TeacherStudentCandidate> {
        val encodedQuery = java.net.URLEncoder.encode(query.trim(), Charsets.UTF_8.name())
        val response: TeacherStudentSearchEnvelope = withAuthenticatedRequest {
            apiClient.requestJson(
                path = "/api/teacher/students?q=$encodedQuery",
                deserializer = TeacherStudentSearchEnvelope.serializer(),
            )
        }
        return response.students
    }

    override suspend fun createRecording(): String {
        TeacherDiagnostics.track("create_recording_start")
        val response: TeacherCreateRecordingResponse = withAuthenticatedRequest {
            apiClient.requestJson(
                path = "/api/teacher/recordings",
                deserializer = TeacherCreateRecordingResponse.serializer(),
                method = "POST",
            )
        }
        TeacherDiagnostics.track(
            name = "create_recording_success",
            recordingId = response.recordingId,
        )
        return response.recordingId
    }

    override suspend fun uploadAudio(
        recordingId: String,
        filePath: String,
        durationSeconds: Double?,
    ): TeacherRecordingSummary? {
        TeacherDiagnostics.track(
            name = "upload_start",
            recordingId = recordingId,
            details = mapOf(
                "durationSeconds" to durationSeconds?.toString(),
                "fileName" to File(filePath).name,
            ),
        )
        return try {
            val file = File(filePath)
            val useDirectBlobUpload = file.length() > TEACHER_RECORDING_DIRECT_BLOB_THRESHOLD_BYTES
            val summary = withAuthenticatedRequest {
                if (useDirectBlobUpload) {
                    apiClient.uploadAudioViaBlob(
                        recordingId = recordingId,
                        filePath = filePath,
                        durationSeconds = durationSeconds,
                    ).recording
                } else {
                    apiClient.uploadAudio(
                        recordingId = recordingId,
                        filePath = filePath,
                        durationSeconds = durationSeconds,
                    ).recording
                }
            }
            deleteLocalFile(filePath)
            TeacherDiagnostics.track(
                name = "upload_success",
                recordingId = recordingId,
                deviceLabel = summary?.deviceLabel,
                details = mapOf(
                    "status" to summary?.status?.name,
                    "uploadMode" to if (useDirectBlobUpload) "direct_blob_multipart" else "api_multipart",
                ),
            )
            summary
        } catch (error: Exception) {
            queuePendingUpload(
                recordingId = recordingId,
                filePath = filePath,
                durationSeconds = durationSeconds,
                errorMessage = error.message,
            )
            TeacherDiagnostics.track(
                name = "upload_failure",
                recordingId = recordingId,
                level = TeacherDiagnosticLevel.ERROR,
                error = error,
                details = mapOf("fileName" to File(filePath).name),
            )
            throw error
        }
    }

    override suspend fun pollRecording(recordingId: String): TeacherRecordingSummary {
        val startedAt = Instant.now()
        val deadline = startedAt.plusMillis(TEACHER_RECORDING_POLL_TIMEOUT_MS)
        TeacherDiagnostics.track(
            name = "poll_start",
            recordingId = recordingId,
        )
        while (Instant.now().isBefore(deadline)) {
            val envelope: TeacherRecordingEnvelope = withAuthenticatedRequest {
                apiClient.requestJson(
                    path = "/api/teacher/recordings/$recordingId/progress",
                    deserializer = TeacherRecordingEnvelope.serializer(),
                )
            }
            val summary = envelope.recording
                ?: throw TeacherApiException(404, "録音セッションが見つかりません。")
            TeacherDiagnostics.track(
                name = "poll_status",
                recordingId = recordingId,
                deviceLabel = summary.deviceLabel,
                details = mapOf("status" to summary.status.name),
            )
            if (summary.status != TeacherRecordingStatus.TRANSCRIBING &&
                summary.status != TeacherRecordingStatus.RECORDING
            ) {
                TeacherDiagnostics.track(
                    name = "poll_result",
                    recordingId = recordingId,
                    deviceLabel = summary.deviceLabel,
                    details = mapOf("status" to summary.status.name),
                )
                return summary
            }
            delay(nextTeacherRecordingPollDelayMs(startedAt))
        }
        TeacherDiagnostics.track(
            name = "poll_timeout",
            recordingId = recordingId,
            level = TeacherDiagnosticLevel.WARNING,
        )
        throw TeacherApiException(408, "処理に時間がかかっています。")
    }

    override suspend fun confirmStudent(recordingId: String, studentId: String?) {
        TeacherDiagnostics.track(
            name = "confirm_start",
            recordingId = recordingId,
            details = mapOf("studentId" to studentId),
        )
        val body = repositoryJson.encodeToString(ConfirmStudentRequest(studentId))
        withAuthenticatedRequest<TeacherConfirmRecordingResponse> {
            apiClient.requestJson(
                path = "/api/teacher/recordings/$recordingId/confirm",
                deserializer = TeacherConfirmRecordingResponse.serializer(),
                method = "POST",
                body = body,
            )
        }
        TeacherDiagnostics.track(
            name = "confirm_success",
            recordingId = recordingId,
            details = mapOf("studentId" to studentId),
        )
    }

    override suspend fun cancelRecording(recordingId: String) {
        TeacherDiagnostics.track(
            name = "cancel_recording_start",
            recordingId = recordingId,
        )
        withAuthenticatedRequest<TeacherLogoutResponse> {
            apiClient.requestJson(
                path = "/api/teacher/recordings/$recordingId/cancel",
                deserializer = TeacherLogoutResponse.serializer(),
                method = "POST",
            )
        }
        TeacherDiagnostics.track(
            name = "cancel_recording_success",
            recordingId = recordingId,
        )
    }

    override suspend fun retryPendingUploads() {
        var firstError: Exception? = null
        val items = pendingUploadStore.loadItems()
        TeacherDiagnostics.track(
            name = "retry_start",
            details = mapOf("pendingCount" to items.size.toString()),
        )
        items.forEach { item ->
            try {
                TeacherDiagnostics.track(
                    name = "retry_upload_start",
                    recordingId = item.recordingId,
                    attemptCount = item.attemptCount,
                    details = mapOf("fileName" to File(item.filePath).name),
                )
                uploadAudio(
                    recordingId = item.recordingId,
                    filePath = item.filePath,
                    durationSeconds = item.durationSeconds,
                )
                pendingUploadStore.remove(item.id)
                TeacherDiagnostics.track(
                    name = "retry_upload_success",
                    recordingId = item.recordingId,
                    attemptCount = item.attemptCount + 1,
                )
            } catch (error: Exception) {
                TeacherDiagnostics.track(
                    name = "retry_upload_failure",
                    recordingId = item.recordingId,
                    attemptCount = item.attemptCount + 1,
                    level = TeacherDiagnosticLevel.ERROR,
                    error = error,
                )
                if (firstError == null) {
                    firstError = error
                }
            }
        }
        TeacherDiagnostics.track(
            name = "retry_result",
            level = if (firstError == null) TeacherDiagnosticLevel.INFO else TeacherDiagnosticLevel.WARNING,
            details = mapOf(
                "attempted" to items.size.toString(),
                "remaining" to pendingUploadStore.loadItems().size.toString(),
            ),
        )
        firstError?.let { throw it }
    }

    private suspend fun <T> withAuthenticatedRequest(block: suspend () -> T): T {
        authRepository.refreshIfNeeded()
        return try {
            block()
        } catch (error: TeacherApiException) {
            if (error.statusCode == 401) {
                TeacherDiagnostics.track(
                    name = "refresh_retry_after_401",
                    level = TeacherDiagnosticLevel.WARNING,
                )
                authRepository.forceRefresh()
                block()
            } else {
                throw error
            }
        }
    }

    private suspend fun queuePendingUpload(
        recordingId: String,
        filePath: String,
        durationSeconds: Double?,
        errorMessage: String?,
    ) {
        val existing = pendingUploadStore.loadItems().firstOrNull { it.recordingId == recordingId }
        val item = PendingUpload(
            id = existing?.id ?: UUID.randomUUID().toString(),
            recordingId = recordingId,
            filePath = filePath,
            createdAt = existing?.createdAt ?: Instant.now().toString(),
            durationSeconds = durationSeconds ?: existing?.durationSeconds,
            attemptCount = (existing?.attemptCount ?: 0) + 1,
            lastAttemptAt = Instant.now().toString(),
            errorMessage = errorMessage,
        )
        pendingUploadStore.save(item)
        TeacherDiagnostics.track(
            name = "pending_queued",
            recordingId = recordingId,
            attemptCount = item.attemptCount,
            level = TeacherDiagnosticLevel.WARNING,
            details = mapOf(
                "fileName" to File(filePath).name,
                "errorMessage" to errorMessage,
            ),
        )
    }

    private fun deleteLocalFile(filePath: String) {
        runCatching {
            File(filePath).takeIf { it.exists() }?.delete()
        }
    }

    private fun nextTeacherRecordingPollDelayMs(startedAt: Instant): Long {
        val elapsedMs = Instant.now().toEpochMilli() - startedAt.toEpochMilli()
        return when {
            elapsedMs < 45_000L -> TEACHER_RECORDING_POLL_FAST_MS
            elapsedMs < 3 * 60_000L -> TEACHER_RECORDING_POLL_WARM_MS
            else -> TEACHER_RECORDING_POLL_SLOW_MS
        }
    }
}
