@echo off
rem Bam chuot phai, chon "Run as administrator"
netsh advfirewall firewall add rule name="Goi mon QR" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
echo Da mo cong 3000 cho mang Rieng tu (Private).
pause
