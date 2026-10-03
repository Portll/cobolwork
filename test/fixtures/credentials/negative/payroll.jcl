//PAYROLL  JOB (ACCT),'RUN',CLASS=A,MSGCLASS=X,USER=&SYSUID,PASSWORD=&PW
//STEP0    JOB (ACCT),'RUN',PASSWORD=XXXXXXXX
//* PASSWORD=K7QX2MPL mentioned in a comment line
//* LOGON PAYADM/Q2W3E4R5 mentioned in a comment line
//SYMJOB   JOB (ACCT),'RUN',USER=&SYSUID,PASSWORD='&PW'
//* PASSWORD='Blue Heron Rides 42' mentioned in a comment line
//STEP1    EXEC PGM=IKJEFT01
//SYSTSIN  DD *
  LOGON PAYADM
  LOGON userid/password
  ALU PAYADM PASSWORD NOEXPIRED
  ALU userid PASSWORD(password)
  LOGON userid/password/newpassword
  PASSWORD INTERVAL(30)
  PW USER(PAYADM) NOINTERVAL
  ALU userid PHRASE('password phrase')
/*
