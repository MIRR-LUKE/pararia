package jp.pararia.teacherapp.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import jp.pararia.teacherapp.app.TeacherAppContainer
import jp.pararia.teacherapp.app.TeacherAppDependencies
import jp.pararia.teacherapp.domain.AudioRecorderClient
import jp.pararia.teacherapp.domain.DeviceLoginInput
import jp.pararia.teacherapp.domain.PendingUpload
import jp.pararia.teacherapp.domain.PendingUploadStore
import jp.pararia.teacherapp.domain.RecorderPermissionStatus
import jp.pararia.teacherapp.domain.TeacherAuthRepository
import jp.pararia.teacherapp.domain.TeacherRecordingRepository
import jp.pararia.teacherapp.domain.TeacherRecordingSummary
import jp.pararia.teacherapp.domain.TeacherRecordingStatus
import jp.pararia.teacherapp.domain.TeacherRoute
import jp.pararia.teacherapp.domain.TeacherUiState
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class TeacherAppViewModel(
    private val authRepository: TeacherAuthRepository,
    private val recordingRepository: TeacherRecordingRepository,
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
        viewModelScope.launch {
            bootstrap()
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun onPermissionRequestHandled() {
        _uiState.update { it.copy(requestMicrophonePermission = false) }
    }

    fun login(email: String, password: String, deviceLabel: String) {
        viewModelScope.launch {
            runWithErrorHandling {
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
            }
        }
    }

    fun openPendingUploads() {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    pendingUploads = pendingUploadStore.loadItems(),
                    route = TeacherRoute.Pending,
                )
            }
        }
    }

    fun returnToStandby() {
        doneReturnJob?.cancel()
        studentSearchJob?.cancel()
        _uiState.update { it.copy(route = TeacherRoute.Standby) }
    }

    fun startRecording() {
        when (audioRecorderClient.permissionStatus()) {
            RecorderPermissionStatus.GRANTED -> {
                viewModelScope.launch {
                    runWithErrorHandling {
                        val recordingId = recordingRepository.createRecording()
                        try {
                            audioRecorderClient.start()
                            activeRecordingId = recordingId
                            recordingSeconds = 0
                            recordingPaused = false
                            startTimer()
                        } catch (error: Exception) {
                            runCatching { recordingRepository.cancelRecording(recordingId) }
                            throw error
                        }
                    }
                }
            }

            RecorderPermissionStatus.DENIED,
            RecorderPermissionStatus.UNDETERMINED -> {
                _uiState.update { it.copy(requestMicrophonePermission = true) }
            }
        }
    }

    fun onMicrophonePermissionResult(granted: Boolean) {
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
        viewModelScope.launch {
            runWithErrorHandling {
                val completed = audioRecorderClient.stop()
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
                recordingRepository.uploadAudio(
                    recordingId = recordingId,
                    filePath = completed.filePath,
                    durationSeconds = completed.durationSeconds,
                )
                val summary = recordingRepository.pollRecording(recordingId)
                applySummary(summary)
            }
        }
    }

    fun pauseRecording() {
        if (activeRecordingId == null || recordingPaused) return
        viewModelScope.launch {
            runWithErrorHandling {
                audioRecorderClient.pause()
                recordingPaused = true
                updateRecordingRoute()
            }
        }
    }

    fun resumeRecording() {
        if (activeRecordingId == null || !recordingPaused) return
        viewModelScope.launch {
            runWithErrorHandling {
                audioRecorderClient.resume()
                recordingPaused = false
                updateRecordingRoute()
            }
        }
    }

    fun cancelRecording() {
        viewModelScope.launch {
            runWithErrorHandling {
                recordingTimerJob?.cancel()
                audioRecorderClient.cancel()
                activeRecordingId?.let { recordingRepository.cancelRecording(it) }
                activeRecordingId = null
                recordingSeconds = 0
                recordingPaused = false
                _uiState.update { it.copy(route = TeacherRoute.Standby) }
            }
        }
    }

    fun importAudio(filePath: String, durationSeconds: Double?) {
        viewModelScope.launch {
            runWithErrorHandling {
                val recordingId = recordingRepository.createRecording()
                _uiState.update {
                    it.copy(
                        route = TeacherRoute.Analyzing(
                            recordingId = recordingId,
                            message = "音声を送信しています。"
                        )
                    )
                }
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
        _uiState.update { it.copy(errorMessage = message) }
    }

    fun confirmStudent(studentId: String?) {
        val summary = currentConfirmSummary() ?: return
        studentSearchJob?.cancel()
        viewModelScope.launch {
            runWithErrorHandling {
                recordingRepository.confirmStudent(summary.id, studentId)
                clearPendingUploads(summary.id)
                showDoneScreen()
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
            runWithErrorHandling {
                recordingRepository.retryPendingUploads()
                val activeRecording = runCatching { recordingRepository.loadActiveRecording() }.getOrNull()
                val pendingUploads = reconcilePendingUploads(
                    activeRecording = activeRecording,
                    pendingUploads = pendingUploadStore.loadItems(),
                )
                syncRouteWithActiveRecording(
                    pendingUploads = pendingUploads,
                    activeRecording = activeRecording,
                )
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
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
        val session = authRepository.currentSession()
        var pendingUploads = pendingUploadStore.loadItems()
        if (session == null) {
            _uiState.update {
                it.copy(
                    session = null,
                    pendingUploads = pendingUploads,
                    route = TeacherRoute.Bootstrap,
                )
            }
            return
        }

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
        followActiveRecording(routeRecording)
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
        when (summary.status) {
            TeacherRecordingStatus.AWAITING_STUDENT_CONFIRMATION -> {
                _uiState.update { it.copy(route = TeacherRoute.Confirm(summary)) }
            }
            TeacherRecordingStatus.STUDENT_CONFIRMED -> showDoneScreen()
            TeacherRecordingStatus.ERROR -> {
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

    private fun showDoneScreen() {
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
            TeacherRecordingStatus.STUDENT_CONFIRMED -> showDoneScreen()
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
        val items = pendingUploadStore.loadItems()
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
        return pendingUploadStore.loadItems()
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

    private suspend fun runWithErrorHandling(block: suspend () -> Unit) {
        try {
            block()
            _uiState.update { it.copy(pendingUploads = pendingUploadStore.loadItems()) }
        } catch (error: Exception) {
            activeRecordingId = null
            recordingPaused = false
            recordingSeconds = 0
            studentSearchJob?.cancel()
            var pendingUploads = runCatching { pendingUploadStore.loadItems() }.getOrDefault(_uiState.value.pendingUploads)
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

    companion object {
        fun factory(container: TeacherAppContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    val dependencies: TeacherAppDependencies = container.dependencies
                    return TeacherAppViewModel(
                        authRepository = dependencies.authRepository,
                        recordingRepository = dependencies.recordingRepository,
                        audioRecorderClient = dependencies.audioRecorderClient,
                        pendingUploadStore = dependencies.pendingUploadStore,
                    ) as T
                }
            }
    }
}
