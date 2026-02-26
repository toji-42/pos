package com.barbaros.caissepos

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

class UsbPrinterModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val ACTION_USB_PERMISSION = "com.barbaros.caissepos.USB_PERMISSION"
    private const val USB_WRITE_TIMEOUT_MS = 5000
  }

  private val usbManager =
    reactContext.getSystemService(Context.USB_SERVICE) as UsbManager

  private val pendingPermissionPromises = ConcurrentHashMap<Int, Promise>()
  private var permissionReceiverRegistered = false

  private val permissionReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != ACTION_USB_PERMISSION) return

      val device = getUsbDeviceFromIntent(intent)
      val deviceId = device?.deviceId ?: return
      val promise = pendingPermissionPromises.remove(deviceId) ?: return

      val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
      promise.resolve(permissionResultMap(granted, if (granted) "Permission USB accordee." else "Permission USB refusee."))
    }
  }

  init {
    registerPermissionReceiver()
  }

  override fun getName(): String = "UsbPrinterModule"

  override fun invalidate() {
    super.invalidate()
    unregisterPermissionReceiver()
    pendingPermissionPromises.clear()
  }

  @ReactMethod
  fun listDevices(promise: Promise) {
    try {
      val devices = Arguments.createArray()
      usbManager.deviceList.values
        .asSequence()
        .filter { isLikelyPrinterDevice(it) }
        .sortedBy { it.deviceId }
        .forEach { device ->
          val productName = runCatching { device.productName }.getOrNull()
          val manufacturerName = runCatching { device.manufacturerName }.getOrNull()
          val serialNumber = runCatching { device.serialNumber }.getOrNull()
          val map = Arguments.createMap()
          map.putInt("deviceId", device.deviceId)
          map.putInt("vendorId", device.vendorId)
          map.putInt("productId", device.productId)
          map.putString("productName", productName)
          map.putString("manufacturerName", manufacturerName)
          map.putString("serialNumber", serialNumber)
          map.putInt("deviceClass", device.deviceClass)
          map.putInt("deviceSubclass", device.deviceSubclass)
          map.putInt("interfaceCount", device.interfaceCount)
          devices.pushMap(map)
        }
      promise.resolve(devices)
    } catch (error: Exception) {
      promise.reject("USB_LIST_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun requestPermission(deviceId: Int, promise: Promise) {
    val device = findDevice(deviceId)
    if (device == null) {
      promise.resolve(permissionResultMap(false, "Imprimante USB introuvable."))
      return
    }
    if (!isLikelyPrinterDevice(device)) {
      promise.resolve(permissionResultMap(false, "Peripherique USB non compatible imprimante (dock/hub)."))
      return
    }

    if (usbManager.hasPermission(device)) {
      promise.resolve(permissionResultMap(true, "Permission USB deja accordee."))
      return
    }

    if (pendingPermissionPromises.containsKey(deviceId)) {
      promise.resolve(permissionResultMap(false, "Demande de permission USB deja en cours."))
      return
    }

    try {
      pendingPermissionPromises[deviceId] = promise
      val flags =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
          PendingIntent.FLAG_UPDATE_CURRENT
        }
      val permissionIntent = PendingIntent.getBroadcast(
        reactContext,
        deviceId,
        Intent(ACTION_USB_PERMISSION),
        flags,
      )
      usbManager.requestPermission(device, permissionIntent)
    } catch (error: Exception) {
      pendingPermissionPromises.remove(deviceId)
      promise.reject("USB_PERMISSION_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun printText(deviceId: Int, text: String, cut: Boolean, promise: Promise) {
    val device = findDevice(deviceId)
    if (device == null) {
      promise.resolve(printResultMap(false, "Imprimante USB introuvable."))
      return
    }
    if (!isLikelyPrinterDevice(device)) {
      promise.resolve(printResultMap(false, "Peripherique USB non compatible imprimante (dock/hub)."))
      return
    }
    if (!usbManager.hasPermission(device)) {
      promise.resolve(printResultMap(false, "Permission USB manquante."))
      return
    }
    if (text.isBlank()) {
      promise.resolve(printResultMap(false, "Ticket vide."))
      return
    }

    try {
      val payload = buildEscPosPayload(text, cut)
      val written = writeToPrinter(device, payload)
      promise.resolve(printResultMap(true, "Impression USB envoyee ($written octets)."))
    } catch (error: Exception) {
      promise.resolve(printResultMap(false, error.message ?: "Erreur impression USB."))
    }
  }

  @ReactMethod
  fun testPrint(deviceId: Int, label: String, promise: Promise) {
    val dateText = SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.FRANCE).format(Date())
    val lines = listOf(
      "TEST IMPRESSION USB",
      label.ifBlank { "IMPRIMANTE USB" },
      "Date: $dateText",
      "Connexion USB OK",
    ).joinToString("\n")
    printText(deviceId, lines, true, promise)
  }

  @ReactMethod
  fun openDrawer(deviceId: Int, promise: Promise) {
    val device = findDevice(deviceId)
    if (device == null) {
      promise.resolve(printResultMap(false, "Imprimante USB introuvable."))
      return
    }
    if (!isLikelyPrinterDevice(device)) {
      promise.resolve(printResultMap(false, "Peripherique USB non compatible imprimante (dock/hub)."))
      return
    }
    if (!usbManager.hasPermission(device)) {
      promise.resolve(printResultMap(false, "Permission USB manquante."))
      return
    }

    try {
      val payload = buildDrawerKickPayload()
      val written = writeToPrinter(device, payload)
      promise.resolve(printResultMap(true, "Ouverture tiroir envoyee ($written octets)."))
    } catch (error: Exception) {
      promise.resolve(printResultMap(false, error.message ?: "Erreur ouverture tiroir USB."))
    }
  }

  private fun registerPermissionReceiver() {
    if (permissionReceiverRegistered) return
    val filter = IntentFilter(ACTION_USB_PERMISSION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(permissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      reactContext.registerReceiver(permissionReceiver, filter)
    }
    permissionReceiverRegistered = true
  }

  private fun unregisterPermissionReceiver() {
    if (!permissionReceiverRegistered) return
    try {
      reactContext.unregisterReceiver(permissionReceiver)
    } catch (_: Exception) {
      // receiver already unregistered
    } finally {
      permissionReceiverRegistered = false
    }
  }

  private fun findDevice(deviceId: Int): UsbDevice? {
    return usbManager.deviceList.values.firstOrNull { it.deviceId == deviceId }
  }

  private fun isLikelyPrinterDevice(device: UsbDevice): Boolean {
    if (device.deviceClass == UsbConstants.USB_CLASS_HUB) {
      return false
    }
    if (device.deviceClass == UsbConstants.USB_CLASS_PRINTER) {
      return true
    }
    for (index in 0 until device.interfaceCount) {
      val usbInterface = device.getInterface(index)
      if (usbInterface.interfaceClass == UsbConstants.USB_CLASS_PRINTER) {
        return true
      }
    }
    return findWritableEndpoint(device) != null
  }

  private fun buildEscPosPayload(text: String, cut: Boolean): ByteArray {
    val normalized = text.replace("\r\n", "\n")
    val init = byteArrayOf(0x1B.toByte(), 0x40.toByte())
    val body = normalized.toByteArray(Charsets.UTF_8)
    val newline = if (normalized.endsWith("\n")) byteArrayOf() else byteArrayOf(0x0A.toByte())
    val feed = byteArrayOf(0x0A.toByte(), 0x0A.toByte(), 0x0A.toByte())
    val cutBytes = if (cut) {
      byteArrayOf(0x1D.toByte(), 0x56.toByte(), 0x41.toByte(), 0x10.toByte())
    } else {
      byteArrayOf()
    }
    return init + body + newline + feed + cutBytes
  }

  private fun buildDrawerKickPayload(): ByteArray {
    val init = byteArrayOf(0x1B.toByte(), 0x40.toByte())
    val pulse = byteArrayOf(0x1B.toByte(), 0x70.toByte(), 0x00.toByte(), 0x19.toByte(), 0xFA.toByte())
    return init + pulse
  }

  private fun writeToPrinter(device: UsbDevice, payload: ByteArray): Int {
    val target = findWritableEndpoint(device)
      ?: throw IllegalStateException("Aucune interface USB imprimante compatible.")
    val usbInterface = target.first
    val endpoint = target.second

    val connection = usbManager.openDevice(device)
      ?: throw IllegalStateException("Impossible d'ouvrir la connexion USB.")

    try {
      val claimed = connection.claimInterface(usbInterface, true)
      if (!claimed) {
        throw IllegalStateException("Impossible de reserver l'interface USB.")
      }

      var offset = 0
      while (offset < payload.size) {
        val chunkSize = minOf(16384, payload.size - offset)
        val written = connection.bulkTransfer(endpoint, payload, offset, chunkSize, USB_WRITE_TIMEOUT_MS)
        if (written <= 0) {
          throw IllegalStateException("Ecriture USB interrompue.")
        }
        offset += written
      }
      return offset
    } finally {
      try {
        connection.releaseInterface(usbInterface)
      } catch (_: Exception) {
        // no-op
      }
      connection.close()
    }
  }

  private fun findWritableEndpoint(device: UsbDevice): Pair<UsbInterface, UsbEndpoint>? {
    for (index in 0 until device.interfaceCount) {
      val usbInterface = device.getInterface(index)
      for (endpointIndex in 0 until usbInterface.endpointCount) {
        val endpoint = usbInterface.getEndpoint(endpointIndex)
        val isBulkOut = endpoint.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
          endpoint.direction == UsbConstants.USB_DIR_OUT
        if (isBulkOut) {
          return Pair(usbInterface, endpoint)
        }
      }
    }
    return null
  }

  private fun getUsbDeviceFromIntent(intent: Intent): UsbDevice? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
    }
  }

  private fun permissionResultMap(granted: Boolean, message: String) = Arguments.createMap().apply {
    putBoolean("granted", granted)
    putString("message", message)
  }

  private fun printResultMap(ok: Boolean, message: String) = Arguments.createMap().apply {
    putBoolean("ok", ok)
    putString("message", message)
  }
}
