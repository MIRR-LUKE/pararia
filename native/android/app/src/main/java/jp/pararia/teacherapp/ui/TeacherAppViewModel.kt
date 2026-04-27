package jp.pararia.teacherapp.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import jp.pararia.teacherapp.app.TeacherAppContainer
import jp.pararia.teacherapp.app.TeacherAppDependencies
import jp.pararia.teacherapp.diagnostics.TeacherDiagnosticLevel
import jp.pararia.teacherapp.diagnostics.TeacherDiagnostics
import jp.pararia.teacherapp.domain.AudioRecorderClient
import jp.pararia.teacherapp.domain.DeviceLoginInput
import jp.pararia.teacherapp.domain.PendingUpload
import jp.pararia.teacherapp.domain.PendingUploadStore
import jp.pararia.teacherapp.domain.RecorderPermissionStatus
import jp.pararia.teacherapp.domain.RecorderStartAvailability
import jp.pararia.teacherapp.domain.TeacherAuthRepository
import jp.pararia.teacherapp.domain.TeacherNotificationRepository
import jp.pararia.teacherapp.domain.TeacherRecordingRepository
import jp.pararia.teacherapp.domain.TeacherRecordingSummary
import jp.pararia.teacherapp.domain.TeacherRecordingStatus
import jp.pararia.teacherapp.domain.TeacherRoute
import jp.pararia.teacherapp.domain.TeacherUiState
import jp.pararia.teacherapp.domain.removeMissingFilePendingUploads
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

class TeacherAppViewModel(
    private val authRepository: TeacherAuthRepository,
    private val recordingRepository: TeacherRecordingRepository,
    private val notificationRepository: TeacherNotificationRepository,
    private val audioRecorderClient: AudioRecorderClient,
    private val pendingUploadStore: PendingUploadStore,
) : ViewModel() {
    private val _uiState = MutableStateFlow(
        TeacherUiState(
            pendingUploads = emptyList()
        )
    )
    val uiState: StateFlow<TeacherUiState> = _uiState.asStateFlow()

    private var activeRecordingId: String? = null
    private var recordingTimerJob: Job? = null
    private var doneReturnJob: Job? = null
    private var studentSearchJob: Job? = null
    private var recordingSeconds: Int = 0
    private var recordingPaused: Boolean = false

    init {
        TeacherDiagnostics.track("viewmodel_created")
        viewModelScope.launch {
            TeacherDiagnostics.events.collect { events ->
                _uiState.update {
                    it.copy(diagnosticReportText = TeacherDiagnostics.formatReport(events))
                }
            }
        }
        viewModelScope.launch {
            bootstrap()
        }
    }

    fun dismissError() {
        trackEvent("error_dismiss")
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun onPermissionRequestHandled() {
        trackEvent("microphone_permission_request_handled")
        _uiState.update { it.copy(requestMicrophonePermission = false) }
    }

    fun onNotificationPermissionRequestHandled() {
        trackEvent("notification_permission_request_handled")
        _uiState.update { it.copy(requestNotificationPermission = false) }
    }

    fun onNotificationPermissionResult(granted: Boolean) {
        trackEvent(
            name = "notification_permission_result",
            level = if (granted) TeacherDiagnosticLevel.INFO else TeacherDiagnosticLevel.WARNING,
            details = mapOf("granted" to granted.toString()),
        )
        syncPushTokenSilently("notification_permission_result")
    }

    fun login(email: String, password: String, deviceLabel: String) {
        trackEvent(
            name = "login_start",
            deviceLabel = deviceLabel,
            details = mapOf("inputDeviceLabel" to deviceLabel),
        )
        viewModelScope.launch {
            runWithErrorHandling(
                operation = "login",
                details = mapOf("inputDeviceLabel" to deviceLabel),
            ) {
                val session = authRepository.login(
                    DeviceLoginInput(
                        email = email,
                        password = password,
                        deviceLabel = deviceLabel,
                    )
                )
                _uiState.update {
                    it.copy(
                        session = session,
                        route = TeacherRoute.Standby,
                    )
                }
                trackEvent(
                    name = "login_success",
                    deviceLabel = session.deviceLabel,
                )
                preparePushNotifications("login_success")
            }
        }
    }

    fun openPendingUploads() {
        viewModelScope.launch {
            val items = loadDisplayPendingUploads("pending_open")
            trackEvent(
                name = "pending_open",
                details = mapOf("pendingCount" to items.size.toString()),
            )
            _uiState.update {
                it.copy(
                    pendingUploads = items,
                    route = TeacherRoute.Pending,
                )
            }
        }
    }

    fun returnToStandby() {
        trackEvent("return_to_standby")
        doneReturnJob?.cancel()
        studentSearchJob?.cancel()
        _uiState.update { it.copy(route = TeacherRoute.Standby) }
    }

    fun startRecording() {
        val permissionStatus = audioRecorderClient.permissionStatus()
        trackEvent(
            name = "recording_start_request",
            details = mapOf("permissionStatus" to permissionStatus.name),
        )
        when (permissionStatus) {
            RecorderPermissionStatus.GRANTED -> {
                val availability = audioRecorderClient.startAvailability()
                trackEvent(
                    name = "recording_start_availability",
                    level = if (availability == RecorderStartAvailability.AVAILABLE) {
                        TeacherDiagnosticLevel.INFO
                    } else {
                        TeacherDiagnosticLevel.WARNING
                    },
                    details = mapOf("availability" to availability.name),
                )
                if (availability == RecorderStartAvailability.SYSTEM_AUDIO_BUSY) {
                    _uiState.update {
                        it.copy(
                            errorMessage = "端末が通話中のため、録音を開始できません。通話を終了してからもう一度試してください。",
                        )
                    }
                    return
                }
                viewModelScope.launch {
                    runWithErrorHandling(operation = "recording_start") {
                        val recordingId = recordingRepository.createRecording()
                        trackEvent(
                            name = "recording_created",
                            recordingId = recordingId,
                        )
                        try {
                            trackEvent(
                                name = "recorder_start_request",
                                recordingId = recordingId,
                            )
                            audioRecorderClient.start()
                            activeRecordingId = recordingId
                            recordingSeconds = 0
                            recordingPaused = false
                            startTimer()
                            trackEvent(
                                name = "recording_started",
                                recordingId = recordingId,
                            )
                        } catch (error: Exception) {
                            runCatching { recordingRepository.cancelRecording(recordingId) }
                            trackEvent(
                                name = "recording_start_cancelled_after_error",
                                recordingId = recordingId,
                                level = TeacherDiagnosticLevel.WARNING,
                                error = error,
                            )
                            throw error
                        }
                    }
                }
            }

            RecorderPermissionStatus.DENIED,
            RecorderPermissionStatus.UNDETERMINED -> {
                trackEvent(
                    name = "microphone_permission_needed",
                    level = TeacherDiagnosticLevel.WARNING,
                    details = mapOf("permissionStatus" to permissionStatus.name),
                )
                _uiState.update { it.copy(requestMicrophonePermission = true) }
            }
        }
    }

    fun onMicrophonePermissionResult(granted: Boolean) {
        trackEvent(
            name = "microphone_permission_result",
            level = if (granted) TeacherDiagnosticLevel.INFO else TeacherDiagnosticLevel.WARNING,
            details = mapOf("granted" to granted.toString()),
        )
        if (granted) {
            startRecording()
        } else {
            _uiState.update {
                it.copy(
                    errorMessage = "マイクを許可してください。",
                    requestMicrophonePermission = false,
                )
            }
        }
    }

    fun stopRecording() {
        val recordingId = activeRecordingId ?: return
        trackEvent(
            name = "recording_stop_request",
            recordingId = recordingId,
        )
        viewModelScope.launch {
            runWithErrorHandling(
                operation = "recording_stop",
                recordingId = recordingId,
            ) {
                val completed = audioRecorderClient.stop()
                trackEvent(
                    name = "recording_stop_completed",
                    recordingId = recordingId,
                    details = mapOf("durationSeconds" to completed.durationSeconds.toString()),
                )
                activeRecordingId = null
                recordingPaused = false
                recordingTimerJob?.cancel()
                _uiState.update {
                    it.copy(
                        route = TeacherRoute.Analyzing(
                            recordingId = recordingId,
                            message = "音声を送信しています。"
                        )
                    )
                }
                trackEvent(
                    name = "upload_route_entered",
                    recordingId = recordingId,
                    route = "analyzing",
                )
                recordingRepository.uploadAudio(
                    recordingId = recordingId,
                    filePath = completed.filePath,
                    durationSeconds = completed.durationSeconds,
                )
                trackEvent(
                    name = "upload_completed",
                    recordingId = recordingId,
                    route = "analyzing",
                )
                val summary = recordingRepository.pollRecording(recordingId)
                applySummary(summary)
            }
        }
    }

    fun pauseRecording() {
        if (activeRecordingId == null || recordingPaused) return
        val recordingId = activeRecordingId
        trackEvent(
            name = "recording_pause_request",
            recordingId = recordingId,
        )
        viewModelScope.launch {
            runWithErrorHandling(
                operation = "recording_pause",
                recordingId = recordingId,
            ) {
                audioRecorderClient.pause()
                recordingPaused = true
                updateRecordingRoute()
                trackEvent(
                    name = "recording_paused",
                    recordingId = recordingId,
                )
            }
        }
    }

    fun resumeRecording() {
        if (activeRecordingId == null || !recordingPaused) return
        val recordingId = activeRecordingId
        trackEvent(
            name = "recording_resume_request",
            recordingId = recordingId,
        )
        viewModelScope.launch {
            runWithErrorHandling(
                operation = "recording_resume",
                recordingId = recordingId,
            ) {
                audioRecorderClient.resume()
                recordingPaused = false
                updateRecordingRoute()
                trackEvent(
                    name = "recording_resumed",
                    recordingId = recordingId,
                )
            }
        }
    }

    fun cancelRecording() {
        val recordingId = activeRecordingId
        trackEvent(
            name = "recording_cancel_request",
            recordingId = recordingId,
            level = TeacherDiagnosticLevel.WARNING,
        )
        viewModelScope.launch {
            runWithErrorHandling(
                operation = "recording_cancel",
                recordingId = recordingId,
            ) {
                recordingTimerJob?.cancel()
                audioRecorderClient.cancel()
                activeRecordingId?.let { recordingRepository.cancelRecording(it) }
                activeRecordingId = null
                recordingSeconds = 0
                recordingPaused = false
                _uiState.update { it.copy(route = TeacherRoute.Standby) }
                trackEvent(
                    name = "recording_cancelled",
                    recordingId = recordingId,
                    route = "standby",
                    level = TeacherDiagnosticLevel.WARNING,
                )
            }
        }
    }

    fun importAudio(filePath: String, durationSeconds: Double?) {
        trackEvent(
            name = "import_audio_start",
            details = mapOf("durationSeconds" to durationSeconds?.toString()),
        )
        viewModelScope.launch {
            runWithErrorHandling(operation = "import_audio") {
                val recordingId = recordingRepository.createRecording()
                trackEvent(
                    name = "import_recording_created",
                    recordingId = recordingId,
                )
                _uiState.update {
                    it.copy(
                        route = TeacherRoute.Analyzing(
                            recordingId = recordingId,
                            message = "音声を送信しています。"
                        )
                    )
                }
                trackEvent(
                    name = "upload_route_entered",
                    recordingId = recordingId,
                    route = "analyzing",
                )
                recordingRepository.uploadAudio(
                    recordingId = recordingId,
                    filePath = filePath,
                    durationSeconds = durationSeconds,
                )
                val summary = recordingRepository.pollRecording(recordingId)
                applySummary(summary)
            }
        }
    }

    fun reportError(message: String) {
        trackEvent(
            name = "ui_report_error",
            level = TeacherDiagnosticLevel.ERROR,
            details = mapOf("message" to message),
        )
        _uiState.update { it.copy(errorMessage = message) }
    }

    fun confirmStudent(studentId: String?) {
        val summary = currentConfirmSummary() ?: return
        trackEvent(
            name = "confirm_request",
            recordingId = summary.id,
            deviceLabel = summary.deviceLabel,
            details = mapOf("studentId" to studentId),
        )
        studentSearchJob?.cancel()
        viewModelScope.launch {
            runWithErrorHandling(
                operation = "confirm",
                recordingId = summary.id,
                details = mapOf("studentId" to studentId),
            ) {
                recordingRepository.confirmStudent(summary.id, studentId)
                clearPendingUploads(summary.id)
                showDoneScreen(recordingId = summary.id, deviceLabel = summary.deviceLabel)
            }
        }
    }

    fun openManualStudentSelect() {
        val summary = currentConfirmSummary() ?: return
        studentSearchJob?.cancel()
        viewModelScope.launch {
            runWithErrorHandling {
                val results = recordingRepository.searchStudents("")
                _uiState.update {
                    it.copy(
                        route = TeacherRoute.ManualStudentSelect(
                            summary = summary,
                            query = "",
                            results = results,
                        )
                    )
                }
            }
        }
    }

    fun closeManualStudentSelect() {
        val route = uiState.value.route as? TeacherRoute.ManualStudentSelect ?: return
        studentSearchJob?.cancel()
        _uiState.update { it.copy(route = TeacherRoute.Confirm(route.summary)) }
    }

    fun updateManualStudentQuery(query: String) {
        val route = uiState.value.route as? TeacherRoute.ManualStudentSelect ?: return
        val nextQuery = query.take(40)
        _uiState.update { it.copy(route = route.copy(query = nextQuery)) }
        studentSearchJob?.cancel()
        studentSearchJob = viewModelScope.launch {
            runWithErrorHandling {
                delay(180)
                val results = recordingRepository.searchStudents(nextQuery)
                _uiState.update { current ->
                    val latestRoute = current.route as? TeacherRoute.ManualStudentSelect ?: return@update current
                    current.copy(route = latestRoute.copy(query = nextQuery, results = results))
                }
            }
        }
    }

    fun retryPendingUploads() {
        viewModelScope.launch {
            val beforeRetry = loadDisplayPendingUploads("retry_pending_before")
            trackEvent(
                name = "retry_request",
                details = mapOf("pendingCount" to beforeRetry.size.toString()),
            )
            runWithErrorHandling(operation = "retry_pending") {
                recordingRepository.retryPendingUploads()
                val activeRecording = runCatching { recordingRepository.loadActiveRecording() }.getOrNull()
                val pendingUploads = reconcilePendingUploads(
                    activeRecording = activeRecording,
                    pendingUploads = loadDisplayPendingUploads("retry_pending_after"),
                )
                syncRouteWithActiveRecording(
                    pendingUploads = pendingUploads,
                    activeRecording = activeRecording,
                )
                trackEvent(
                    name = "retry_result",
                    recordingId = activeRecording?.id,
                    deviceLabel = activeRecording?.deviceLabel,
                    details = mapOf("pendingCount" to pendingUploads.size.toString()),
                )
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            trackEvent("logout_request")
            authRepository.logout()
            activeRecordingId = null
            recordingTimerJob?.cancel()
            studentSearchJob?.cancel()
            _uiState.update {
                it.copy(
                    session = null,
                    route = TeacherRoute.Bootstrap,
                    pendingUploads = emptyList(),
                    errorMessage = null,
                )
            }
        }
    }

    private suspend fun bootstrap() {
        trackEvent("bootstrap_start", route = "bootstrap")
        val session = authRepository.currentSession()
        var pendingUploads = loadDisplayPendingUploads("bootstrap")
        if (session == null) {
            trackEvent(
                name = "bootstrap_no_session",
                route = "bootstrap",
                details = mapOf("pendingCount" to pendingUploads.size.toString()),
            )
            _uiState.update {
                it.copy(
                    session = null,
                    pendingUploads = pendingUploads,
                    route = TeacherRoute.Bootstrap,
                )
            }
            return
        }
        trackEvent(
            name = "bootstrap_session_restored",
            deviceLabel = session.deviceLabel,
            route = "bootstrap",
            details = mapOf("pendingCount" to pendingUploads.size.toString()),
        )

        val activeRecording = runCatching { recordingRepository.loadActiveRecording() }.getOrNull()
        pendingUploads = reconcilePendingUploads(activeRecording, pendingUploads)
        val recoveredPendingRecording = if (activeRecording == null && pendingUploads.isNotEmpty()) {
            val result = reconcilePendingUploadsWithServer(pendingUploads)
            pendingUploads = result.pendingUploads
            result.recording
        } else {
            null
        }
        val routeRecording = activeRecording ?: recoveredPendingRecording
        _uiState.update {
            it.copy(
                session = session,
                pendingUploads = pendingUploads,
                route = nextRouteForActiveRecording(routeRecording),
            )
        }
        trackEvent(
            name = "bootstrap_route_ready",
            recordingId = routeRecording?.id,
            deviceLabel = routeRecording?.deviceLabel ?: session.deviceLabel,
            details = mapOf(
                "pendingCount" to pendingUploads.size.toString(),
                "activeStatus" to routeRecording?.status?.name,
            ),
        )
        preparePushNotifications("bootstrap_session_restored")
        followActiveRecording(routeRecording)
    }

    private fun preparePushNotifications(reason: String) {
        if (notificationRepository.shouldRequestNotificationPermission()) {
            trackEvent("notification_permission_needed", details = mapOf("reason" to reason))
            _uiState.update { it.copy(requestNotificationPermission = true) }
            return
        }
        syncPushTokenSilently(reason)
    }

    private fun syncPushTokenSilently(reason: String) {
        viewModelScope.launch {
            runCatching { notificationRepository.syncPushToken() }
                .onSuccess {
                    trackEvent("push_token_sync_finished", details = mapOf("reason" to reason))
                }
                .onFailure { error ->
                    trackEvent(
                        name = "push_token_sync_failed",
                        level = TeacherDiagnosticLevel.WARNING,
                        error = error,
                        details = mapOf("reason" to reason),
                    )
                }
        }
    }

    private fun startTimer() {
        recordingTimerJob?.cancel()
        updateRecordingRoute()
        recordingTimerJob = viewModelScope.launch {
            while (true) {
                delay(1_000)
                if (!recordingPaused) {
                    recordingSeconds += 1
                    updateRecordingRoute()
                }
            }
        }
    }

    private fun updateRecordingRoute() {
        _uiState.update {
            it.copy(
                route = TeacherRoute.Recording(
                    seconds = recordingSeconds,
                    paused = recordingPaused,
                )
            )
        }
    }

    private fun applySummary(summary: TeacherRecordingSummary) {
        activeRecordingId = null
        studentSearchJob?.cancel()
        trackEvent(
            name = "recording_summary_result",
            recordingId = summary.id,
            deviceLabel = summary.deviceLabel,
            details = mapOf("status" to summary.status.name),
        )
        when (summary.status) {
            TeacherRecordingStatus.AWAITING_STUDENT_CONFIRMATION -> {
                trackEvent(
                    name = "confirm_route_entered",
                    recordingId = summary.id,
                    deviceLabel = summary.deviceLabel,
                    route = "confirm",
                )
                _uiState.update { it.copy(route = TeacherRoute.Confirm(summary)) }
            }
            TeacherRecordingStatus.STUDENT_CONFIRMED -> showDoneScreen(
                recordingId = summary.id,
                deviceLabel = summary.deviceLabel,
            )
            TeacherRecordingStatus.ERROR -> {
                trackEvent(
                    name = "recording_result_error",
                    recordingId = summary.id,
                    deviceLabel = summary.deviceLabel,
                    level = TeacherDiagnosticLevel.ERROR,
                    details = mapOf("message" to summary.errorMessage),
                )
                _uiState.update {
                    it.copy(
                        errorMessage = summary.errorMessage ?: "処理に失敗しました。",
                        route = TeacherRoute.Standby,
                    )
                }
            }
            else -> {
                _uiState.update { it.copy(route = TeacherRoute.Standby) }
            }
        }
    }

    private fun showDoneScreen(
        recordingId: String? = activeRecordingId,
        deviceLabel: String? = uiState.value.session?.deviceLabel,
    ) {
        trackEvent(
            name = "done",
            recordingId = recordingId,
            deviceLabel = deviceLabel,
            route = "done",
        )
        activeRecordingId = null
        recordingSeconds = 0
        recordingPaused = false
        doneReturnJob?.cancel()
        _uiState.update {
            it.copy(
                route = TeacherRoute.Done(
                    title = "送信しました",
                    message = "ログを作成しています。"
                )
            )
        }
        doneReturnJob = viewModelScope.launch {
            delay(3_000)
            _uiState.update { state ->
                state.copy(route = TeacherRoute.Standby)
            }
        }
    }

    private fun resumeProgress(recordingId: String) {
        viewModelScope.launch {
            runWithErrorHandling {
                val summary = recordingRepository.pollRecording(recordingId)
                applySummary(summary)
            }
        }
    }

    private fun syncRouteWithActiveRecording(
        pendingUploads: List<PendingUpload>,
        activeRecording: TeacherRecordingSummary?,
    ) {
        studentSearchJob?.cancel()
        _uiState.update {
            it.copy(
                pendingUploads = pendingUploads,
                route = nextRouteForActiveRecording(activeRecording),
                errorMessage = null,
            )
        }
        followActiveRecording(activeRecording)
    }

    private fun nextRouteForActiveRecording(activeRecording: TeacherRecordingSummary?): TeacherRoute =
        when (activeRecording?.status) {
            TeacherRecordingStatus.AWAITING_STUDENT_CONFIRMATION -> TeacherRoute.Confirm(activeRecording)
            TeacherRecordingStatus.TRANSCRIBING -> TeacherRoute.Analyzing(
                recordingId = activeRecording.id,
                message = "生徒候補を確認しています。"
            )
            TeacherRecordingStatus.STUDENT_CONFIRMED -> TeacherRoute.Done(
                title = "送信しました",
                message = "ログを作成しています。"
            )
            else -> TeacherRoute.Standby
        }

    private fun currentConfirmSummary(): TeacherRecordingSummary? =
        when (val route = uiState.value.route) {
            is TeacherRoute.Confirm -> route.summary
            is TeacherRoute.ManualStudentSelect -> route.summary
            else -> null
        }

    private fun followActiveRecording(activeRecording: TeacherRecordingSummary?) {
        when (activeRecording?.status) {
            TeacherRecordingStatus.TRANSCRIBING -> resumeProgress(activeRecording.id)
            TeacherRecordingStatus.STUDENT_CONFIRMED -> showDoneScreen(
                recordingId = activeRecording.id,
                deviceLabel = activeRecording.deviceLabel,
            )
            else -> Unit
        }
    }

    private suspend fun reconcilePendingUploads(
        activeRecording: TeacherRecordingSummary?,
        pendingUploads: List<PendingUpload>,
    ): List<PendingUpload> {
        val recordingId = activeRecording?.id ?: return pendingUploads
        if (activeRecording.status == TeacherRecordingStatus.RECORDING) return pendingUploads
        return clearPendingUploads(recordingId, pendingUploads)
    }

    private suspend fun clearPendingUploads(recordingId: String): List<PendingUpload> {
        val items = loadDisplayPendingUploads("clear_pending_by_recording")
        return clearPendingUploads(recordingId, items)
    }

    private suspend fun clearPendingUploads(
        recordingId: String,
        items: List<PendingUpload>,
    ): List<PendingUpload> {
        val staleItems = items.filter { it.recordingId == recordingId }
        if (staleItems.isEmpty()) {
            return items
        }
        staleItems.forEach { pendingUploadStore.remove(it.id) }
        return loadDisplayPendingUploads("clear_pending_by_recording")
    }

    private suspend fun loadDisplayPendingUploads(reason: String): List<PendingUpload> {
        val cleanup = pendingUploadStore.removeMissingFilePendingUploads()
        cleanup.removedItems.forEach { item ->
            trackEvent(
                name = "pending_stale_removed",
                recordingId = item.recordingId,
                attemptCount = item.attemptCount,
                level = TeacherDiagnosticLevel.WARNING,
                details = mapOf(
                    "reason" to reason,
                    "fileName" to File(item.filePath).name,
                ),
            )
        }
        return cleanup.pendingUploads
    }

    private suspend fun reconcilePendingUploadsWithServer(
        items: List<PendingUpload>,
    ): PendingReconciliationResult {
        var nextItems = items
        var recoveredRecording: TeacherRecordingSummary? = null
        items.forEach { item ->
            val summary = runCatching { recordingRepository.loadRecording(item.recordingId) }.getOrNull()
                ?: return@forEach
            if (summary.status != TeacherRecordingStatus.RECORDING &&
                summary.status != TeacherRecordingStatus.TRANSCRIBING
            ) {
                nextItems = clearPendingUploads(item.recordingId, nextItems)
            }
            if (recoveredRecording == null &&
                summary.status != TeacherRecordingStatus.ERROR &&
                summary.status != TeacherRecordingStatus.CANCELLED
            ) {
                recoveredRecording = summary
            }
        }
        return PendingReconciliationResult(
            pendingUploads = nextItems,
            recording = recoveredRecording,
        )
    }

    private suspend fun runWithErrorHandling(
        operation: String = "operation",
        recordingId: String? = activeRecordingId,
        details: Map<String, String?> = emptyMap(),
        block: suspend () -> Unit,
    ) {
        try {
            block()
            val pendingUploads = loadDisplayPendingUploads("${operation}_success")
            _uiState.update { it.copy(pendingUploads = pendingUploads) }
        } catch (error: Exception) {
            trackEvent(
                name = "${operation}_failure",
                recordingId = recordingId ?: activeRecordingId,
                level = TeacherDiagnosticLevel.ERROR,
                error = error,
                details = details,
            )
            activeRecordingId = null
            recordingPaused = false
            recordingSeconds = 0
            studentSearchJob?.cancel()
            var pendingUploads = runCatching {
                loadDisplayPendingUploads("${operation}_failure")
            }.getOrDefault(_uiState.value.pendingUploads)
            val activeRecording = runCatching { recordingRepository.loadActiveRecording() }.getOrNull()
            if (activeRecording != null) {
                pendingUploads = reconcilePendingUploads(activeRecording, pendingUploads)
                syncRouteWithActiveRecording(
                    pendingUploads = pendingUploads,
                    activeRecording = activeRecording,
                )
                return
            }
            if (pendingUploads.isNotEmpty()) {
                val result = reconcilePendingUploadsWithServer(pendingUploads)
                if (result.recording != null) {
                    syncRouteWithActiveRecording(
                        pendingUploads = result.pendingUploads,
                        activeRecording = result.recording,
                    )
                    return
                }
                pendingUploads = result.pendingUploads
            }
            _uiState.update {
                val fallbackRoute = when {
                    it.session == null -> TeacherRoute.Bootstrap
                    it.route is TeacherRoute.Pending -> TeacherRoute.Pending
                    else -> TeacherRoute.Standby
                }
                it.copy(
                    pendingUploads = pendingUploads,
                    errorMessage = error.message ?: "処理に失敗しました。",
                    route = fallbackRoute,
                )
            }
        }
    }

    private data class PendingReconciliationResult(
        val pendingUploads: List<PendingUpload>,
        val recording: TeacherRecordingSummary?,
    )

    private fun trackEvent(
        name: String,
        recordingId: String? = activeRecordingId,
        deviceLabel: String? = uiState.value.session?.deviceLabel,
        route: String? = routeName(uiState.value.route),
        attemptCount: Int? = null,
        level: TeacherDiagnosticLevel = TeacherDiagnosticLevel.INFO,
        error: Throwable? = null,
        details: Map<String, String?> = emptyMap(),
    ) {
        TeacherDiagnostics.track(
            name = name,
            recordingId = recordingId,
            deviceLabel = deviceLabel,
            route = route,
            attemptCount = attemptCount,
            level = level,
            error = error,
            details = details,
        )
    }

    private fun routeName(route: TeacherRoute): String =
        when (route) {
            TeacherRoute.Bootstrap -> "bootstrap"
            TeacherRoute.Standby -> "standby"
            is TeacherRoute.Recording -> "recording"
            is TeacherRoute.Analyzing -> "analyzing"
            is TeacherRoute.Confirm -> "confirm"
            is TeacherRoute.ManualStudentSelect -> "manual_student_select"
            is TeacherRoute.Done -> "done"
            TeacherRoute.Pending -> "pending"
        }

    companion object {
        fun factory(container: TeacherAppContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    val dependencies: TeacherAppDependencies = container.dependencies
                    return TeacherAppViewModel(
                        authRepository = dependencies.authRepository,
                        recordingRepository = dependencies.recordingRepository,
                        notificationRepository = dependencies.notificationRepository,
                        audioRecorderClient = dependencies.audioRecorderClient,
                        pendingUploadStore = dependencies.pendingUploadStore,
                    ) as T
                }
            }
    }
}
