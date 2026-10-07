; MAO: mo tuong lua khi cai (mang Private/Domain), xoa khi go. Du lieu o Documents\MAO khong bi xoa.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MAO"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="MAO" dir=in action=allow program="$INSTDIR\MAO.exe" enable=yes profile=private,domain'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MAO"'
!macroend
