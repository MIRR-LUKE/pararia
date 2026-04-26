package jp.pararia.teacherapp.app

import android.content.Context
import jp.pararia.teacherapp.config.AppConfig
import jp.pararia.teacherapp.data.DataStorePendingUploadStore
import jp.pararia.teacherapp.data.DataStoreTeacherTokenStore
import jp.pararia.teacherapp.data.DefaultTeacherAuthRepository
import jp.pararia.teacherapp.data.DefaultTeacherRecordingRepository
import jp.pararia.teacherapp.data.TeacherApiClient
import jp.pararia.teacherapp.data.TeacherPersistentStateStore
import jp.pararia.teacherapp.notifications.DefaultTeacherNotificationRepository
import jp.pararia.teacherapp.recording.AndroidAudioRecorderClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class TeacherAppContainer(context: Context) {
    private val applicationContext = context.applicationContext
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val persistentStateStore = TeacherPersistentStateStore(applicationContext)
    private val tokenStore = DataStoreTeacherTokenStore(persistentStateStore)
    private val pendingUploadStore = DataStorePendingUploadStore(persistentStateStore)
    private val apiClient = TeacherApiClient(
        config = AppConfig.current,
        tokenStore = tokenStore
    )
    private val authRepository = DefaultTeacherAuthRepository(
        apiClient = apiClient,
        tokenStore = tokenStore
    )
    private val recordingRepository = DefaultTeacherRecordingRepository(
        apiClient = apiClient,
        authRepository = authRepository,
        pendingUploadStore = pendingUploadStore
    )
    private val notificationRepository = DefaultTeacherNotificationRepository(
        context = applicationContext,
        apiClient = apiClient,
    )
    private val audioRecorderClient = AndroidAudioRecorderClient(applicationContext)

    val dependencies = TeacherAppDependencies(
        authRepository = authRepository,
        recordingRepository = recordingRepository,
        notificationRepository = notificationRepository,
        audioRecorderClient = audioRecorderClient,
        pendingUploadStore = pendingUploadStore
    )

    fun launchNotificationSync() {
        appScope.launch {
            runCatching { notificationRepository.syncPushToken() }
        }
    }
}

data class TeacherAppDependencies(
    val authRepository: jp.pararia.teacherapp.domain.TeacherAuthRepository,
    val recordingRepository: jp.pararia.teacherapp.domain.TeacherRecordingRepository,
    val notificationRepository: jp.pararia.teacherapp.domain.TeacherNotificationRepository,
    val audioRecorderClient: jp.pararia.teacherapp.domain.AudioRecorderClient,
    val pendingUploadStore: jp.pararia.teacherapp.domain.PendingUploadStore
)
