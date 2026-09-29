       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONSLOG.
      * Writes a password to the console two ways, and a count to SYSOUT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PASSWORD        PIC X(8).
       01 WS-COUNT           PIC 9(4).
       PROCEDURE DIVISION.
           DISPLAY WS-PASSWORD UPON CONSOLE
           DISPLAY WS-COUNT UPON SYSOUT
           EXEC CICS WRITE OPERATOR TEXT(WS-PASSWORD)
                TEXTLENGTH(8) END-EXEC
           GOBACK.
