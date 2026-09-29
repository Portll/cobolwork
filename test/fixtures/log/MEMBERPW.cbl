       IDENTIFICATION DIVISION.
       PROGRAM-ID. PWMEMBER.
      * Prompts, reads a password and shows it back. A job in this
      * repository runs it, so the prompt reads SYSIN and the DISPLAY
      * goes to SYSOUT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PASSWORD         PIC X(8).
       PROCEDURE DIVISION.
           DISPLAY "Enter password: "
           ACCEPT WS-PASSWORD
           DISPLAY WS-PASSWORD
           GOBACK.
