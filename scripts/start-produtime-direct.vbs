Option Explicit
Dim shell, fso, exe
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
exe = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\PT-1.6.9-x64\ProduTime.exe"
If fso.FileExists(exe) Then
  ' 1 = activate/normal window, False = do not wait
  ' --no-sandbox is REQUIRED for running from network/Parallels shared folders
  shell.Run """" & exe & """ --no-sandbox --disable-gpu --disable-gpu-sandbox --disable-features=CalculateNativeWinOcclusion,UseAngle --use-angle=swiftshader", 1, False
Else
  shell.Popup "ProduTime.exe not found at: " & exe, 6, "ProduTime launcher", 48
End If

