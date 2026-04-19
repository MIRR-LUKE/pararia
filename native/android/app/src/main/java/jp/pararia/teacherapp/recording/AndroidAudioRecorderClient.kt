package jp.pararia.teacherapp.recording

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import jp.pararia.teacherapp.domain.AudioRecorderClient
import jp.pararia.teacherapp.domain.CompletedRecording
import jp.pararia.teacherapp.domain.RecorderPermissionStatus
import java.io.File
import java.io.IOException
import java.util.UUID

class AndroidAudioRecorderClient(
    private val context: Context
) : AudioRecorderClient {
    private var recorder: MediaRecorder? = null
    private var currentFile: File? = null
    private var recordingStartedAtMs: Long? = null

    override fun permissionStatus(): RecorderPermissionStatus {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        return if (granted) RecorderPermissionStatus.GRANTED else RecorderPermissionStatus.DENIED
    }

    override fun start() {
        if (permissionStatus() != RecorderPermissionStatus.GRANTED) {
            throw IOException("マイクを許可してください。")
        }

        val outputDirectory = File(context.filesDir, "recordings").apply { mkdirs() }
        val outputFile = File(outputDirectory, "teacher-${UUID.randomUUID()}.m4a")

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
            throw IOException("録音を開始できませんでした。", error)
        }

        recorder = nextRecorder
        currentFile = outputFile
        recordingStartedAtMs = SystemClock.elapsedRealtime()
    }

    override fun stop(): CompletedRecording {
        val activeRecorder = recorder ?: throw IOException("録音中ではありません。")
        val outputFile = currentFile ?: throw IOException("録音ファイルが見つかりません。")
        val startedAt = recordingStartedAtMs ?: SystemClock.elapsedRealtime()

        runCatching { activeRecorder.stop() }
            .onFailure {
                cleanupCurrentRecording(deleteFile = true)
                throw IOException("録音を終了できませんでした。", it)
            }

        activeRecorder.reset()
        activeRecorder.release()
        recorder = null
        currentFile = null
        recordingStartedAtMs = null
        RecordingForegroundService.stop(context)

        return CompletedRecording(
            filePath = outputFile.absolutePath,
            durationSeconds = (SystemClock.elapsedRealtime() - startedAt) / 1_000.0,
        )
    }

    override fun cancel() {
        cleanupCurrentRecording(deleteFile = true)
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
        RecordingForegroundService.stop(context)
    }
}
