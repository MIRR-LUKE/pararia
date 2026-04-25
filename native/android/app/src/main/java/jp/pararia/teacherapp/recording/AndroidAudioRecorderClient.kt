package jp.pararia.teacherapp.recording

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import jp.pararia.teacherapp.diagnostics.TeacherDiagnosticLevel
import jp.pararia.teacherapp.diagnostics.TeacherDiagnostics
import jp.pararia.teacherapp.domain.AudioRecorderClient
import jp.pararia.teacherapp.domain.CompletedRecording
import jp.pararia.teacherapp.domain.RecorderPermissionStatus
import jp.pararia.teacherapp.domain.RecorderStartAvailability
import java.io.File
import java.io.IOException
import java.util.UUID

class AndroidAudioRecorderClient(
    private val context: Context
) : AudioRecorderClient {
    private var recorder: MediaRecorder? = null
    private var currentFile: File? = null
    private var recordingStartedAtMs: Long? = null
    private var accumulatedRecordingMs: Long = 0L
    private var paused: Boolean = false

    override fun permissionStatus(): RecorderPermissionStatus {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        return if (granted) RecorderPermissionStatus.GRANTED else RecorderPermissionStatus.DENIED
    }

    override fun startAvailability(): RecorderStartAvailability {
        val audioManager = context.getSystemService(AudioManager::class.java)
            ?: return RecorderStartAvailability.AVAILABLE
        return when (audioManager.mode) {
            AudioManager.MODE_IN_CALL,
            AudioManager.MODE_IN_COMMUNICATION,
            AudioManager.MODE_CALL_SCREENING -> RecorderStartAvailability.SYSTEM_AUDIO_BUSY
            else -> RecorderStartAvailability.AVAILABLE
        }
    }

    override fun start() {
        if (permissionStatus() != RecorderPermissionStatus.GRANTED) {
            TeacherDiagnostics.track(
                name = "recorder_start_permission_denied",
                level = TeacherDiagnosticLevel.WARNING,
            )
            throw IOException("マイクを許可してください。")
        }

        if (startAvailability() == RecorderStartAvailability.SYSTEM_AUDIO_BUSY) {
            TeacherDiagnostics.track(
                name = "recorder_start_system_audio_busy",
                level = TeacherDiagnosticLevel.WARNING,
            )
            throw IOException("端末が通話中のため、録音を開始できません。通話を終了してからもう一度試してください。")
        }

        val outputDirectory = File(context.filesDir, "recordings").apply { mkdirs() }
        val outputFile = File(outputDirectory, "teacher-${UUID.randomUUID()}.m4a")
        TeacherDiagnostics.track(
            name = "recorder_start",
            details = mapOf("fileName" to outputFile.name),
        )

        RecordingForegroundService.start(context)

        val nextRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        try {
            nextRecorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(44_100)
                setAudioEncodingBitRate(128_000)
                setOutputFile(outputFile.absolutePath)
                prepare()
                start()
            }
        } catch (error: Exception) {
            runCatching { nextRecorder.release() }
            RecordingForegroundService.stop(context)
            runCatching { outputFile.delete() }
            TeacherDiagnostics.track(
                name = "recorder_start_failure",
                level = TeacherDiagnosticLevel.ERROR,
                error = error,
                details = mapOf("fileName" to outputFile.name),
            )
            throw IOException("録音を開始できませんでした。", error)
        }

        recorder = nextRecorder
        currentFile = outputFile
        recordingStartedAtMs = SystemClock.elapsedRealtime()
        accumulatedRecordingMs = 0L
        paused = false
        TeacherDiagnostics.track(
            name = "recorder_start_success",
            details = mapOf("fileName" to outputFile.name),
        )
    }

    override fun pause() {
        val activeRecorder = recorder ?: throw IOException("録音中ではありません。")
        if (paused) return
        try {
            TeacherDiagnostics.track("recorder_pause")
            activeRecorder.pause()
            val startedAt = recordingStartedAtMs ?: SystemClock.elapsedRealtime()
            accumulatedRecordingMs += (SystemClock.elapsedRealtime() - startedAt)
            recordingStartedAtMs = null
            paused = true
            TeacherDiagnostics.track("recorder_pause_success")
        } catch (error: Exception) {
            TeacherDiagnostics.track(
                name = "recorder_pause_failure",
                level = TeacherDiagnosticLevel.ERROR,
                error = error,
            )
            throw IOException("録音を一時停止できませんでした。", error)
        }
    }

    override fun resume() {
        val activeRecorder = recorder ?: throw IOException("録音中ではありません。")
        if (!paused) return
        try {
            TeacherDiagnostics.track("recorder_resume")
            activeRecorder.resume()
            recordingStartedAtMs = SystemClock.elapsedRealtime()
            paused = false
            TeacherDiagnostics.track("recorder_resume_success")
        } catch (error: Exception) {
            TeacherDiagnostics.track(
                name = "recorder_resume_failure",
                level = TeacherDiagnosticLevel.ERROR,
                error = error,
            )
            throw IOException("録音を再開できませんでした。", error)
        }
    }

    override fun stop(): CompletedRecording {
        val activeRecorder = recorder ?: throw IOException("録音中ではありません。")
        val outputFile = currentFile ?: throw IOException("録音ファイルが見つかりません。")
        TeacherDiagnostics.track(
            name = "recorder_stop",
            details = mapOf("fileName" to outputFile.name),
        )
        val durationMs = accumulatedRecordingMs +
            if (paused) {
                0L
            } else {
                val startedAt = recordingStartedAtMs ?: SystemClock.elapsedRealtime()
                SystemClock.elapsedRealtime() - startedAt
            }

        runCatching { activeRecorder.stop() }
            .onFailure {
                cleanupCurrentRecording(deleteFile = true)
                TeacherDiagnostics.track(
                    name = "recorder_stop_failure",
                    level = TeacherDiagnosticLevel.ERROR,
                    error = it,
                    details = mapOf("fileName" to outputFile.name),
                )
                throw IOException("録音を終了できませんでした。", it)
            }

        activeRecorder.reset()
        activeRecorder.release()
        recorder = null
        currentFile = null
        recordingStartedAtMs = null
        RecordingForegroundService.stop(context)
        TeacherDiagnostics.track(
            name = "recorder_stop_success",
            details = mapOf(
                "fileName" to outputFile.name,
                "durationSeconds" to (durationMs / 1_000.0).toString(),
            ),
        )

        return CompletedRecording(
            filePath = outputFile.absolutePath,
            durationSeconds = durationMs / 1_000.0,
        )
    }

    override fun cancel() {
        TeacherDiagnostics.track(
            name = "recorder_cancel",
            details = mapOf("hasFile" to (currentFile != null).toString()),
        )
        cleanupCurrentRecording(deleteFile = true)
        TeacherDiagnostics.track("recorder_cancel_success")
    }

    private fun cleanupCurrentRecording(deleteFile: Boolean) {
        runCatching { recorder?.reset() }
        runCatching { recorder?.release() }
        if (deleteFile) {
            runCatching { currentFile?.delete() }
        }
        recorder = null
        currentFile = null
        recordingStartedAtMs = null
        accumulatedRecordingMs = 0L
        paused = false
        RecordingForegroundService.stop(context)
    }
}
