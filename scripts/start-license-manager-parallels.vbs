Option Explicit
' License Manager launcher for Parallels/Network Shared Folders
' This launcher adds --no-sandbox flag which is REQUIRED for Electron apps
' running from network shares (Parallels C:\Mac\Home\... paths)
' See: https://github.com/electron/electron/issues/27356

Dim shell, fso, exe, desktopPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Try Desktop export first (Parallels shared folder)
desktopPath = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Desktop\ProduTime-LicenseManager-Portable\ProduTime License Manager.exe"
If fso.FileExists(desktopPath) Then
  exe = desktopPath
Else
  ' Fallback to local Documents folder
  exe = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\PT-LicenseManager-Test\ProduTime License Manager.exe"
End If

If fso.FileExists(exe) Then
  ' 1 = activate/normal window, False = do not wait
  ' --no-sandbox is REQUIRED for running from network/Parallels shared folders
  shell.Run """" & exe & """ --no-sandbox --disable-gpu", 1, False
Else
  shell.Popup "License Manager not found at:" & vbCrLf & exe, 6, "License Manager launcher", 48
End If

