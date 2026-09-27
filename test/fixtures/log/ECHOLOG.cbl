       IDENTIFICATION DIVISION.
       PROGRAM-ID. ECHOLOG.
      * Typed passwords that still reach a log: one sent to the console,
      * one whose bytes a file read also fills, one a subprogram is
      * handed and may replace.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT USER-FILE ASSIGN TO "users.dat".
       DATA DIVISION.
       FILE SECTION.
       FD USER-FILE.
       01 USER-REC            PIC X(20).
       WORKING-STORAGE SECTION.
       01 WS-TYPED-PASSWORD   PIC X(8).
       01 WS-USER             PIC X(20).
       01 FILLER REDEFINES WS-USER.
          03 WS-NAME          PIC X(12).
          03 WS-PASSWORD      PIC X(8).
       01 WS-LOOKUP-PASSWORD  PIC X(8).
       PROCEDURE DIVISION.
           DISPLAY "Enter password: "
           ACCEPT WS-TYPED-PASSWORD
           DISPLAY WS-TYPED-PASSWORD UPON CONSOLE
           DISPLAY "Enter password: "
           ACCEPT WS-PASSWORD
           OPEN INPUT USER-FILE
           READ USER-FILE INTO WS-USER
           DISPLAY WS-PASSWORD
           CLOSE USER-FILE
           DISPLAY "Enter password: "
           ACCEPT WS-LOOKUP-PASSWORD
           CALL "PWLOOKUP" USING WS-NAME WS-LOOKUP-PASSWORD
           DISPLAY WS-LOOKUP-PASSWORD
           GOBACK.
