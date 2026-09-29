       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYLOG.
      * Writes what it was trusted with to SYSOUT and to a queue.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-EMP-SSN          PIC X(11).
       01 WS-RDBMS-PASSWD     PIC X(16).
       01 WS-MASKED-PAN       PIC X(19).
       01 DED-FICA-ACCT-NO    PIC X(8).
       01 WS-COMPANY-NAME     PIC X(30).
       01 WS-AUDIT-REC        PIC X(80).
       PROCEDURE DIVISION.
           DISPLAY WS-RDBMS-PASSWD
           DISPLAY WS-EMP-SSN
           DISPLAY WS-MASKED-PAN
           DISPLAY DED-FICA-ACCT-NO
           DISPLAY WS-COMPANY-NAME
           EXEC CICS WRITEQ TD QUEUE('AUDT') FROM(WS-EMP-SSN)
                LENGTH(11) END-EXEC
           GOBACK.
