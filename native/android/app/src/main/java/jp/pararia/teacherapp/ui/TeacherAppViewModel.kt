package jp.pararia.teacherapp.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import jp.pararia.teacherapp.app.TeacherAppContainer
import jp.pararia.teacherapp.app.TeacherAppDependencies
import jp.pararia.teacherapp.domain.AudioRecorderClient
import jp.pararia.teacherapp.domain.DeviceLoginInput
import jp.pararia.teacherapp.domain.PendingUploadStore
import jp.pararia.teacherapp.domain.RecorderPermissionStatus
import jp.pararia.teacherapp.domain.TeacherAuthRepository
import jp.pararia.teacherapp.domain.TeacherRecordingRepository
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
        _uiState.update { it.copy(route = TeacherRoute.Standby) }
    }

    fun startRecording() {
        when (audioRecorderClient.permissionStatus()) {
            RecorderPermissionStatus.GRANTED -> {
                viewModelScope.launch {
                    runWithErrorHandling {
                        val recordingId = recordingRepository.createRecording()
                        audioRecorderClient.start()
                        activeRecordingId = recordingId
                        startTimer()
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

    fun cancelRecording() {
        viewModelScope.launch {
            runWithErrorHandling {
                recordingTimerJob?.cancel()
                audioRecorderClient.cancel()
                activeRecordingId?.let { recordingRepository.cancelRecording(it) }
                activeRecordingId = null
                _uiState.update { it.copy(route = TeacherRoute.Standby) }
            }
        }
    }

    fun confirmStudent(studentId: String?) {
        val summary = (uiState.value.route as? TeacherRoute.Confirm)?.summary ?: return
        viewModelScope.launch {
            runWithErrorHandling {
                recordingRepository.confirmStudent(summary.id, studentId)
                showDoneScreen()
            }
        }
    }

    fun retryPendingUploads() {
        viewModelScope.launch {
            runWithErrorHandling {
                recordingRepository.retryPendingUploads()
                _uiState.update {
                    it.copy(
                        pendingUploads = pendingUploadStore.loadItems(),
                        route = TeacherRoute.Standby,
                    )
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
            activeRecordingId = null
            recordingTimerJob?.cancel()
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
        val pendingUploads = pendingUploadStore.loadItems()
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
        val nextRoute = when (activeRecording) {
            null -> TeacherRoute.Standby
            else -> when (activeRecording.status) {
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
        }
        _uiState.update {
            it.copy(
                session = session,
                pendingUploads = pendingUploads,
                route = nextRoute
            )
        }
        when (activeRecording?.status) {
            TeacherRecordingStatus.TRANSCRIBING -> resumeProgress(activeRecording.id)
            TeacherRecordingStatus.STUDENT_CONFIRMED -> showDoneScreen()
            else -> Unit
        }
    }

    private fun startTimer() {
        recordingTimerJob?.cancel()
        _uiState.update { it.copy(route = TeacherRoute.Recording(seconds = 0)) }
        recordingTimerJob = viewModelScope.launch {
            var seconds = 0
            while (true) {
                delay(1_000)
                seconds += 1
                _uiState.update { it.copy(route = TeacherRoute.Recording(seconds = seconds)) }
            }
        }
    }

    private fun applySummary(summary: TeacherRecordingSummary) {
        activeRecordingId = null
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

    private suspend fun runWithErrorHandling(block: suspend () -> Unit) {
        try {
            block()
            _uiState.update { it.copy(pendingUploads = pendingUploadStore.loadItems()) }
        } catch (error: Exception) {
            activeRecordingId = null
            _uiState.update {
                val fallbackRoute = when {
                    it.session == null -> TeacherRoute.Bootstrap
                    it.route is TeacherRoute.Pending -> TeacherRoute.Pending
                    else -> TeacherRoute.Standby
                }
                it.copy(
                    pendingUploads = runCatching { pendingUploadStore.loadItems() }.getOrDefault(it.pendingUploads),
                    errorMessage = error.message ?: "処理に失敗しました。",
                    route = fallbackRoute,
                )
            }
        }
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
                        audioRecorderClient = dependencies.audioRecorderClient,
                        pendingUploadStore = dependencies.pendingUploadStore,
                    ) as T
                }
            }
    }
}
