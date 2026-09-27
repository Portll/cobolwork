       IDENTIFICATION DIVISION.
       PROGRAM-ID. STORED.
      * Creates an account from what is typed, and shows an
      * administrator the password on file for another.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT USER-FILE ASSIGN TO "Record.txt"
               ORGANIZATION IS INDEXED ACCESS IS RANDOM
               RECORD KEY IS USER-ID.
       DATA DIVISION.
       FILE SECTION.
       FD USER-FILE.
       01 USER-RECORD.
          02 USER-ID          PIC X(10).
          02 USER-PASSWORD    PIC X(30).
       PROCEDURE DIVISION.
       CREATE-ACCOUNT.
           OPEN I-O USER-FILE
           DISPLAY "NEW USER-ID: " WITH NO ADVANCING
           ACCEPT USER-ID
           DISPLAY "NEW PASSWORD: " WITH NO ADVANCING
           ACCEPT USER-PASSWORD
           WRITE USER-RECORD.
       SHOW-ACCOUNT.
           DISPLAY "ENTER USER-ID: " WITH NO ADVANCING
           ACCEPT USER-ID
           READ USER-FILE KEY IS USER-ID
           DISPLAY "PASSWORD: " USER-PASSWORD
           CLOSE USER-FILE
           GOBACK.
