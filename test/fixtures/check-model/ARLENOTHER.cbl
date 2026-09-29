       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARLENOTHER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-BUF              PIC X(80).
       01 WS-OTHER            PIC X(200).
       01 WS-LEN              PIC 9(4).
       01 WS-J                PIC 9(4).
       01 WS-C                PIC X.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-J
           MOVE FUNCTION LENGTH(FUNCTION TRIM(WS-OTHER)) TO WS-LEN
           PERFORM VARYING WS-J FROM 1 BY 1 UNTIL WS-J > WS-LEN
              MOVE WS-BUF(WS-J:1) TO WS-C
           END-PERFORM
           GOBACK.
