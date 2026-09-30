       IDENTIFICATION DIVISION.
       PROGRAM-ID. UNSTRCOUNT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(3000).
       01 WS-PART             PIC X(80).
       01 WS-LEN              PIC 9(9) COMP.
       01 WS-I                PIC 9(4) COMP.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE 1 TO WS-I
           PERFORM UNTIL WS-I >= LENGTH OF WS-IN
               MOVE ZEROS TO WS-LEN
               UNSTRING WS-IN(WS-I:) DELIMITED BY ","
                   INTO WS-PART COUNT IN WS-LEN
               END-UNSTRING
               ADD WS-LEN, 2 TO WS-I
           END-PERFORM
           GOBACK.
